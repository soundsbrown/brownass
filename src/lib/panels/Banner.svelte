<script lang="ts">
  import logo from "$lib/assets/logo.png";
</script>

<div class="banner">
  <img src={logo} alt="" width="56" height="56" />
  <span class="name">BrownASS</span>
</div>

<style>
  .banner {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 12px 14px;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
    user-select: none;
  }

  img {
    flex: none;
    border-radius: 12px;
  }

  .name {
    font-size: 26px;
    font-weight: 600;
    letter-spacing: 0.01em;
    color: var(--fg);
  }
</style>
