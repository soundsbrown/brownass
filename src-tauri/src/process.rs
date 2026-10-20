//! Spawning child processes that can't outlive the app.
//!
//! On Windows, killing a parent leaves its children running. Every child is
//! therefore put in one job object created with "kill on job close": when
//! the app exits, however it exits, Windows closes the job and ends them.

use std::io;

use tokio::process::{Child, Command};

/// Spawns `cmd` and ties the child's lifetime to the app's.
pub fn spawn(cmd: &mut Command) -> io::Result<Child> {
    let child = cmd.spawn()?;
    #[cfg(windows)]
    windows::assign(&child);
    Ok(child)
}

#[cfg(windows)]
mod windows {
    use std::sync::OnceLock;

    use tokio::process::Child;
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
        SetInformationJobObject,
    };

    /// The job handle, stored as an integer because raw handles aren't `Send`.
    /// It is deliberately never closed: closing it is what kills the children.
    fn job() -> Option<HANDLE> {
        static JOB: OnceLock<Option<usize>> = OnceLock::new();
        JOB.get_or_init(|| {
            // SAFETY: plain Win32 calls with valid arguments; the info struct
            // is zeroed (all limits off) apart from the one flag we set.
            unsafe {
                let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if job.is_null() {
                    return None;
                }
                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                let ok = SetInformationJobObject(
                    job,
                    JobObjectExtendedLimitInformation,
                    (&raw const info).cast(),
                    size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );
                (ok != 0).then_some(job as usize)
            }
        })
        .map(|job| job as HANDLE)
    }

    pub fn assign(child: &Child) {
        if let (Some(job), Some(process)) = (job(), child.raw_handle()) {
            // SAFETY: both handles are valid; failure (e.g. the child already
            // exited) only means it isn't tied to the app, as before.
            unsafe {
                AssignProcessToJobObject(job, process as HANDLE);
            }
        }
    }
}
