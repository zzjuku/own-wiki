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
    /// The action would create a file path that may be too long on Windows.
    /// The UI asks the user and retries with permission.
    #[error("{0}")]
    LongPath(String),
    /// The file was changed (or deleted) outside the app since the app read
    /// it, so the save was refused (M10: no blind overwrites).
    #[error("{0}")]
    Changed(String),
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

impl AppError {
    fn kind(&self) -> &'static str {
        match self {
            AppError::Invalid(_) => "invalid",
            AppError::NotFound(_) => "notFound",
            AppError::Exists(_) => "exists",
            AppError::LongPath(_) => "longPath",
            AppError::Changed(_) => "changed",
            AppError::Io(_) => "io",
            AppError::Yaml(_) | AppError::Json(_) => "data",
            AppError::Trash(_) => "trash",
        }
    }
}

/// Sent to the UI as `{ kind, message }`.
impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut s = serializer.serialize_struct("AppError", 2)?;
        s.serialize_field("kind", self.kind())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

pub type AppResult<T> = Result<T, AppError>;
