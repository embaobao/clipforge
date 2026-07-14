#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextDetection {
    pub payload_kind: String,
    pub sub_kind: Option<String>,
    pub is_sensitive: bool,
}

pub fn detect_text(content: &str) -> TextDetection {
    let trimmed = content.trim();
    let lower = trimmed.to_lowercase();
    let (payload_kind, sub_kind) = if lower.starts_with("<!doctype html")
        || lower.starts_with("<html")
        || lower.contains("<body")
    {
        ("html".to_string(), Some("html".to_string()))
    } else if looks_like_path(trimmed, &lower) {
        ("file".to_string(), Some("path".to_string()))
    } else if looks_like_image_path(&lower) {
        ("image".to_string(), Some("path-image".to_string()))
    } else if looks_like_url(trimmed, &lower) {
        ("link".to_string(), Some("url".to_string()))
    } else if looks_like_email(trimmed) {
        ("text".to_string(), Some("email".to_string()))
    } else if looks_like_color(trimmed, &lower) {
        ("text".to_string(), Some("color".to_string()))
    } else if trimmed.starts_with('{') || trimmed.starts_with('[') {
        ("json".to_string(), Some("json".to_string()))
    } else if looks_like_chart_data(trimmed) {
        ("chart".to_string(), Some("chart-data".to_string()))
    } else if trimmed.contains('\t')
        || trimmed
            .lines()
            .any(|line| line.starts_with('|') && line.ends_with('|'))
    {
        ("table".to_string(), Some("table".to_string()))
    } else if trimmed.starts_with('#') || trimmed.contains("```") || trimmed.contains("\n- ") {
        ("markdown".to_string(), Some("markdown".to_string()))
    } else {
        ("text".to_string(), None)
    };
    TextDetection {
        payload_kind,
        sub_kind,
        is_sensitive: looks_sensitive(trimmed, &lower),
    }
}

pub fn looks_sensitive(content: &str, lower: &str) -> bool {
    if lower.contains("authorization: bearer ")
        || lower.contains("api_key=")
        || lower.contains("apikey=")
        || lower.contains("access_token=")
        || lower.contains("secret_key=")
        || lower.contains("private_key")
    {
        return true;
    }
    content
        .split(|ch: char| {
            ch.is_whitespace() || matches!(ch, '"' | '\'' | ',' | ';' | ')' | ']' | '}')
        })
        .any(|token| {
            token.starts_with("sk-")
                || token.starts_with("ghp_")
                || token.starts_with("github_pat_")
                || token.starts_with("xoxb-")
                || token.starts_with("xoxp-")
                || (token.starts_with("AKIA") && token.len() >= 16)
                || looks_like_jwt(token)
        })
}

fn looks_like_url(trimmed: &str, lower: &str) -> bool {
    lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("mailto:")
        || lower.starts_with("ftp://")
        || (trimmed.starts_with("www.") && trimmed.contains('.'))
}

fn looks_like_email(trimmed: &str) -> bool {
    if trimmed.contains(char::is_whitespace) || !trimmed.contains('@') {
        return false;
    }
    let Some((local, domain)) = trimmed.split_once('@') else {
        return false;
    };
    !local.is_empty() && domain.contains('.') && !domain.starts_with('.') && !domain.ends_with('.')
}

fn looks_like_color(trimmed: &str, lower: &str) -> bool {
    let hex = trimmed.strip_prefix('#').unwrap_or("");
    matches!(hex.len(), 3 | 4 | 6 | 8) && hex.chars().all(|ch| ch.is_ascii_hexdigit())
        || lower.starts_with("rgb(")
        || lower.starts_with("rgba(")
        || lower.starts_with("hsl(")
        || lower.starts_with("hsla(")
}

fn looks_like_path(trimmed: &str, lower: &str) -> bool {
    lower.starts_with("file://")
        || lower.starts_with("~/")
        || trimmed.starts_with('/')
        || trimmed.starts_with("./")
        || trimmed.starts_with("../")
        || trimmed
            .lines()
            .all(|line| line.starts_with('/') || line.starts_with("~/"))
            && trimmed.contains('.')
        || (trimmed.len() > 3
            && trimmed.as_bytes()[1] == b':'
            && trimmed.as_bytes()[2] == b'\\'
            && trimmed.as_bytes()[0].is_ascii_alphabetic())
}

fn looks_like_image_path(lower: &str) -> bool {
    ["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"]
        .iter()
        .any(|ext| lower.ends_with(&format!(".{ext}")))
}

fn looks_like_jwt(token: &str) -> bool {
    let parts = token.split('.').collect::<Vec<_>>();
    parts.len() == 3
        && parts[0].len() >= 8
        && parts[1].len() >= 8
        && parts.iter().all(|part| {
            part.chars()
                .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
        })
}

fn looks_like_chart_data(content: &str) -> bool {
    let lines: Vec<&str> = content.lines().collect();
    if lines.len() < 2 {
        return false;
    }
    if lines.iter().all(|line| line.split(',').count() >= 2) {
        let numeric_cells = lines[1..]
            .iter()
            .flat_map(|line| line.split(','))
            .filter(|cell| cell.trim().parse::<f64>().is_ok())
            .count();
        let total_cells = lines[1..]
            .iter()
            .map(|line| line.split(',').count())
            .sum::<usize>();
        if total_cells > 0 && numeric_cells >= total_cells / 2 {
            return true;
        }
    }
    if lines
        .iter()
        .all(|line| line.starts_with('|') && line.ends_with('|'))
    {
        let numeric_cells = lines[1..]
            .iter()
            .flat_map(|line| line.split('|'))
            .filter(|cell| cell.trim().parse::<f64>().is_ok())
            .count();
        let total_cells = lines[1..]
            .iter()
            .map(|line| line.split('|').count().saturating_sub(2))
            .sum::<usize>();
        if total_cells > 0 && numeric_cells >= total_cells / 2 {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::detect_text;

    #[test]
    fn detects_common_text_subtypes() {
        assert_eq!(
            detect_text("https://example.com/a").sub_kind.as_deref(),
            Some("url")
        );
        assert_eq!(
            detect_text("hello@example.com").sub_kind.as_deref(),
            Some("email")
        );
        assert_eq!(detect_text("#ff00aa").sub_kind.as_deref(), Some("color"));
        assert_eq!(
            detect_text("/Users/me/file.txt").sub_kind.as_deref(),
            Some("path")
        );
    }

    #[test]
    fn marks_sensitive_tokens() {
        assert!(detect_text("Authorization: Bearer sk-test-token").is_sensitive);
        assert!(detect_text("github token ghp_abcdefghijklmnopqrstuvwxyz").is_sensitive);
        assert!(!detect_text("normal clipboard text").is_sensitive);
    }
}
