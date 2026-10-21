//! "Open on another computer" (M10): while a project is open, the app keeps a
//! small marker in the project folder: `_open/<computer id>.json` with the
//! computer's name, since when, and when it was last refreshed (every few
//! minutes). One file per computer, so the markers themselves never clash in
//! Drive. Opening a project while another computer's marker is fresh shows a
//! warning; a stale one (a crash, or a computer that went to sleep) is
//! ignored. Closing the project removes the marker. Markers aren't pages and
//! aren't exported.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::error::AppResult;
use crate::fsutil::safe_write;

pub const MARKERS_DIR: &str = "_open";
/// A marker not refreshed for this long (seconds) is ignored. The app refreshes every 2 minutes.
pub const STALE_AFTER: u64 = 6 * 60;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Marker {
    /// The computer's name, as shown in the warning.
    pub computer: String,
    /// Open since (ms since 1970).
    pub since: u64,
    /// Last refreshed (ms since 1970).
    pub refreshed: u64,
}

pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn path(project_dir: &Path, me: &str) -> PathBuf {
    project_dir.join(MARKERS_DIR).join(format!("{me}.json"))
}

/// Other computers that have the project open now (fresh markers only), at time `now`.
pub fn others(project_dir: &Path, me: &str, now: u64) -> Vec<Marker> {
    let Ok(list) = fs::read_dir(project_dir.join(MARKERS_DIR)) else { return Vec::new() };
    let mut out: Vec<Marker> = list
        .flatten()
        .filter(|e| e.file_name().to_string_lossy() != format!("{me}.json"))
        .filter_map(|e| serde_json::from_str::<Marker>(&fs::read_to_string(e.path()).ok()?).ok())
        .filter(|m| now.saturating_sub(m.refreshed) < STALE_AFTER * 1000)
        .collect();
    out.sort_by_key(|m| m.since);
    out
}

/// Writes (or refreshes) this computer's marker; `since` stays from an existing one.
pub fn mark_open(project_dir: &Path, me: &str, computer: &str, now: u64) -> AppResult<()> {
    let file = path(project_dir, me);
    let since = fs::read_to_string(&file)
        .ok()
        .and_then(|t| serde_json::from_str::<Marker>(&t).ok())
        .filter(|m| now.saturating_sub(m.refreshed) < STALE_AFTER * 1000)
        .map_or(now, |m| m.since);
    fs::create_dir_all(project_dir.join(MARKERS_DIR))?;
    let m = Marker { computer: computer.to_string(), since, refreshed: now };
    safe_write(&file, serde_json::to_string_pretty(&m)?.as_bytes())?;
    Ok(())
}

/// Removes this computer's marker (the app's own bookkeeping, so not to the Trash).
pub fn mark_closed(project_dir: &Path, me: &str) {
    let _ = fs::remove_file(path(project_dir, me));
    // Leave no empty folder behind.
    let _ = fs::remove_dir(project_dir.join(MARKERS_DIR));
}

/// This computer's name ("Jakub's MacBook Air", "DESKTOP-1234").
pub fn computer_name() -> String {
    #[cfg(target_os = "macos")]
    if let Ok(out) = std::process::Command::new("scutil").args(["--get", "ComputerName"]).output() {
        let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if out.status.success() && !name.is_empty() {
            return name;
        }
    }
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .ok()
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| "another computer".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_markers_of_other_computers_only() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        let t0 = 1_000_000_000_000;
        mark_open(dir, "me", "Computer A", t0).unwrap();
        mark_open(dir, "other", "Computer B", t0).unwrap();
        // My own marker never warns; the other one does while fresh.
        assert_eq!(others(dir, "me", t0 + 60_000).iter().map(|m| m.computer.as_str()).collect::<Vec<_>>(), vec!["Computer B"]);
        assert!(others(dir, "other", t0).iter().all(|m| m.computer == "Computer A"));
        // Refreshing keeps "since".
        mark_open(dir, "other", "Computer B", t0 + 120_000).unwrap();
        let m = &others(dir, "me", t0 + 130_000)[0];
        assert_eq!((m.since, m.refreshed), (t0, t0 + 120_000));
        // Not refreshed for longer than STALE_AFTER: ignored.
        assert!(others(dir, "me", t0 + 120_000 + STALE_AFTER * 1000 + 1).is_empty());
        // Closing removes it.
        mark_closed(dir, "other");
        assert!(others(dir, "me", t0 + 130_000).is_empty());
        mark_closed(dir, "me");
        assert!(!dir.join(MARKERS_DIR).exists());
    }
}
