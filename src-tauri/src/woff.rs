//! Decoding WOFF (1.0) fonts to plain TrueType/OpenType data, for fonts
//! embedded in SVGs. WOFF is an sfnt whose tables are zlib-compressed one by
//! one, so decoding is rebuilding the sfnt header and inflating each table.

const HEADER_LEN: usize = 44;
const ENTRY_LEN: usize = 20;

fn u16_at(data: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_be_bytes(data.get(at..at + 2)?.try_into().ok()?))
}

fn u32_at(data: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes(data.get(at..at + 4)?.try_into().ok()?))
}

/// Whether `data` is a WOFF 1.0 font.
pub fn is_woff(data: &[u8]) -> bool {
    data.starts_with(b"wOFF")
}

/// Whether `data` is a WOFF 2.0 font (not supported).
pub fn is_woff2(data: &[u8]) -> bool {
    data.starts_with(b"wOF2")
}

/// The sfnt font inside a WOFF 1.0 file, or `None` if it's malformed.
pub fn decode(data: &[u8]) -> Option<Vec<u8>> {
    if !is_woff(data) {
        return None;
    }
    let flavor = u32_at(data, 4)?;
    let num_tables = u16_at(data, 12)?;

    struct Table {
        tag: [u8; 4],
        checksum: u32,
        data: Vec<u8>,
    }
    let mut tables = Vec::with_capacity(num_tables as usize);
    for i in 0..num_tables as usize {
        let entry = HEADER_LEN + i * ENTRY_LEN;
        let tag: [u8; 4] = data.get(entry..entry + 4)?.try_into().ok()?;
        let offset = u32_at(data, entry + 4)? as usize;
        let comp_len = u32_at(data, entry + 8)? as usize;
        let orig_len = u32_at(data, entry + 12)? as usize;
        let checksum = u32_at(data, entry + 16)?;
        let stored = data.get(offset..offset.checked_add(comp_len)?)?;
        let table = if comp_len < orig_len {
            miniz_oxide::inflate::decompress_to_vec_zlib_with_limit(stored, orig_len).ok()?
        } else {
            stored.to_vec()
        };
        if table.len() != orig_len {
            return None;
        }
        tables.push(Table {
            tag,
            checksum,
            data: table,
        });
    }

    // sfnt header: the table directory must be sorted by tag.
    tables.sort_by_key(|t| t.tag);
    let n = tables.len() as u16;
    let entry_selector = 15 - n.max(1).leading_zeros() as u16;
    let search_range = (1u16 << entry_selector) * 16;
    let mut out = Vec::new();
    out.extend_from_slice(&flavor.to_be_bytes());
    out.extend_from_slice(&n.to_be_bytes());
    out.extend_from_slice(&search_range.to_be_bytes());
    out.extend_from_slice(&entry_selector.to_be_bytes());
    out.extend_from_slice(&(n * 16 - search_range).to_be_bytes());

    let mut offset = 12 + 16 * tables.len();
    for t in &tables {
        out.extend_from_slice(&t.tag);
        out.extend_from_slice(&t.checksum.to_be_bytes());
        out.extend_from_slice(&(offset as u32).to_be_bytes());
        out.extend_from_slice(&(t.data.len() as u32).to_be_bytes());
        offset += t.data.len().next_multiple_of(4);
    }
    for t in &tables {
        out.extend_from_slice(&t.data);
        out.resize(out.len().next_multiple_of(4), 0);
    }
    Some(out)
}

#[cfg(test)]
pub mod tests {
    use super::*;

    /// Packs an sfnt font as WOFF, compressing tables where that helps.
    pub fn encode(sfnt: &[u8]) -> Vec<u8> {
        let num_tables = u16_at(sfnt, 4).unwrap() as usize;
        let mut entries = Vec::new();
        let mut body = Vec::new();
        let data_start = HEADER_LEN + num_tables * ENTRY_LEN;
        for i in 0..num_tables {
            let record = 12 + i * 16;
            let tag = &sfnt[record..record + 4];
            let checksum = u32_at(sfnt, record + 4).unwrap();
            let offset = u32_at(sfnt, record + 8).unwrap() as usize;
            let len = u32_at(sfnt, record + 12).unwrap() as usize;
            let table = &sfnt[offset..offset + len];
            let compressed = miniz_oxide::deflate::compress_to_vec_zlib(table, 6);
            let stored = if compressed.len() < len {
                compressed
            } else {
                table.to_vec()
            };
            let mut entry = tag.to_vec();
            entry.extend_from_slice(&((data_start + body.len()) as u32).to_be_bytes());
            entry.extend_from_slice(&(stored.len() as u32).to_be_bytes());
            entry.extend_from_slice(&(len as u32).to_be_bytes());
            entry.extend_from_slice(&checksum.to_be_bytes());
            entries.push(entry);
            body.extend_from_slice(&stored);
            body.resize(body.len().next_multiple_of(4), 0);
        }
        let mut woff = b"wOFF".to_vec();
        woff.extend_from_slice(&sfnt[0..4]);
        woff.extend_from_slice(&((data_start + body.len()) as u32).to_be_bytes());
        woff.extend_from_slice(&(num_tables as u16).to_be_bytes());
        woff.resize(HEADER_LEN, 0);
        for e in entries {
            woff.extend_from_slice(&e);
        }
        woff.extend_from_slice(&body);
        woff
    }

    pub fn system_font() -> Option<Vec<u8>> {
        std::fs::read(r"C:\Windows\Fonts\arial.ttf").ok()
    }

    #[test]
    fn decodes_to_a_font_with_the_same_glyphs() {
        let Some(ttf) = system_font() else { return };
        let decoded = decode(&encode(&ttf)).unwrap();
        let original = ttf_parser::Face::parse(&ttf, 0).unwrap();
        let face = ttf_parser::Face::parse(&decoded, 0).unwrap();
        assert_eq!(face.number_of_glyphs(), original.number_of_glyphs());
        let a = original.glyph_index('A').unwrap();
        assert_eq!(face.glyph_index('A'), Some(a));
        assert_eq!(face.glyph_bounding_box(a), original.glyph_bounding_box(a));
    }

    #[test]
    fn rejects_malformed_files() {
        assert!(decode(b"wOFF").is_none());
        assert!(decode(b"true").is_none());
        let Some(ttf) = system_font() else { return };
        let mut woff = encode(&ttf);
        woff.truncate(woff.len() / 2);
        assert!(decode(&woff).is_none());
    }
}
