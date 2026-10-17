use serde::{Serialize, Serializer};

/// Errors returned to the UI. The `Display` text is shown to the user as-is,
/// so keep messages short and non-technical.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Invalid(String),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Exists(String),
    #[error("File error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Could not read page data: {0}")]
    Yaml(#[from] serde_yaml_ng::Error),
    #[error("Could not read project data: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Could not move to Trash: {0}")]
    #[cfg_attr(test, allow(dead_code))]
    Trash(String),
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
