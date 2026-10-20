<script lang="ts">
  import { formatTime, parseTime, type Seconds } from "$lib/time";

  interface Props {
    label: string;
    value: Seconds;
    fps: number;
    /**
     * Receives the typed or nudged time (`nudge`: from ↑/↓, so consecutive
     * calls may merge into one undo step); the caller snaps and clamps it.
     */
    onchange: (value: Seconds, nudge: boolean) => void;
  }
  let { label, value, fps, onchange }: Props = $props();
  const id = $props.id();

  let text = $state("");
  /** The user has typed something not yet applied. */
  let dirty = $state(false);
  let invalid = $state(false);

  // Show the current value (also after ↑/↓, undo, or dragging on the
  // timeline) unless the user has typed something not yet applied.
  $effect(() => {
    const shown = formatTime(value);
    if (!dirty) text = shown;
  });

  function commit() {
    if (!dirty) return;
    dirty = false;
    const t = parseTime(text);
    if (t === null) {
      invalid = true;
      text = formatTime(value);
      setTimeout(() => (invalid = false), 800);
      return;
    }
    if (Math.abs(t - value) > 1e-9) onchange(t, false);
  }

  function onkeydown(e: KeyboardEvent & { currentTarget: HTMLInputElement }) {
    if (e.key === "Enter") {
      commit();
      e.currentTarget.blur();
    } else if (e.key === "Escape") {
      dirty = false;
      text = formatTime(value);
      e.currentTarget.blur();
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const step = e.shiftKey ? 1 : 1 / fps;
      onchange(value + (e.key === "ArrowUp" ? step : -step), true);
    }
  }
</script>

<label class="label" for={id}>{label}</label>
<input
  {id}
  class="time"
  class:invalid
  bind:value={text}
  spellcheck="false"
  title="H:MM:SS.mmm, M:SS or seconds. ↑/↓ change by a frame (Shift: a second)."
  oninput={() => (dirty = true)}
  onblur={commit}
  {onkeydown}
/>

<style>
  .time {
    width: 110px;
    font-variant-numeric: tabular-nums;
  }

  .invalid {
    border-color: var(--error);
  }
</style>
