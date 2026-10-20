//! Stable hashing for file names derived from paths (caches, fallbacks).

use std::path::Path;

/// FNV-1a over the concatenated parts. Tiny and, unlike `DefaultHasher`,
/// stable across Rust versions, so derived file names stay valid.
pub fn fnv1a(parts: &[&[u8]]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in parts.iter().flat_map(|p| p.iter()) {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

pub fn path_key(path: &Path) -> u64 {
    fnv1a(&[path.as_os_str().as_encoded_bytes()])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_stable() {
        // Changing this orphans every user's cached and fallback files.
        assert_eq!(fnv1a(&[b"a", b"bc"]), fnv1a(&[b"abc"]));
        assert_eq!(fnv1a(&[b"abc"]), 0xe71f_a219_0541_574b);
    }
}
