use std::io::Cursor;
use std::path::PathBuf;

use image::ImageFormat;

use super::payload::ImagePayload;

#[derive(Debug, Clone)]
pub struct ImageStore {
    root: PathBuf,
}

#[derive(Debug, Clone)]
pub struct StoredImage {
    pub file_name: String,
    pub origin_path: PathBuf,
    pub thumbnail_path: PathBuf,
    pub width: i64,
    pub height: i64,
    pub size: i64,
    pub hash: String,
}

impl ImageStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn store(&self, image: &ImagePayload) -> Result<StoredImage, String> {
        let hash = blake3::hash(&image.bytes).to_hex().to_string();
        let file_name = format!("{hash}.png");
        let origin_path = self.origin_path(&file_name);
        write_if_absent(&origin_path, &image.bytes)?;
        let thumbnail_path = self.ensure_thumbnail(&file_name)?;
        Ok(StoredImage {
            file_name,
            origin_path,
            thumbnail_path,
            width: i64::from(image.width),
            height: i64::from(image.height),
            size: image.bytes.len() as i64,
            hash,
        })
    }

    pub fn origin_path(&self, file_name: &str) -> PathBuf {
        self.root
            .join("origin")
            .join(shard_dir(file_name))
            .join(file_name)
    }

    pub fn thumbnail_path(&self, file_name: &str) -> PathBuf {
        self.root
            .join("thumbnails")
            .join(shard_dir(file_name))
            .join(file_name)
    }

    pub fn ensure_thumbnail(&self, file_name: &str) -> Result<PathBuf, String> {
        let thumbnail_path = self.thumbnail_path(file_name);
        if thumbnail_path.exists() {
            return Ok(thumbnail_path);
        }
        let origin_path = self.origin_path(file_name);
        let bytes = std::fs::read(&origin_path).map_err(|error| error.to_string())?;
        let image = image::load_from_memory(&bytes).map_err(|error| error.to_string())?;
        let thumb = image.thumbnail(300, 300);
        let mut out = Vec::new();
        thumb
            .write_to(&mut Cursor::new(&mut out), ImageFormat::Png)
            .map_err(|error| error.to_string())?;
        write_if_absent(&thumbnail_path, &out)?;
        Ok(thumbnail_path)
    }

    pub fn remove(&self, file_name: &str) -> Result<(), String> {
        remove_if_exists(self.origin_path(file_name))?;
        remove_if_exists(self.thumbnail_path(file_name))?;
        Ok(())
    }
}

fn shard_dir(file_name: &str) -> &str {
    file_name.get(0..2).unwrap_or("00")
}

fn write_if_absent(path: &PathBuf, bytes: &[u8]) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    std::fs::write(path, bytes).map_err(|error| error.to_string())
}

fn remove_if_exists(path: PathBuf) -> Result<(), String> {
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}
