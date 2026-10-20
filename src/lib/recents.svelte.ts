import { invoke, isTauri } from "@tauri-apps/api/core";
import type { RecentVideo } from "$lib/player/api";

/** Recently opened videos, most recent first (kept by the backend). */
class Recents {
  list = $state<RecentVideo[]>([]);

  async refresh(): Promise<void> {
    if (!isTauri()) return;
    try {
      this.list = await invoke<RecentVideo[]>("recent_videos");
    } catch {
      // The list is only a convenience.
    }
  }

  async forget(path: string): Promise<void> {
    this.list = this.list.filter((r) => r.path !== path);
    await invoke("forget_recent", { path }).catch(() => {});
  }
}

export const recents = new Recents();
