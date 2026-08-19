use once_cell::sync::Lazy;
use regex::Regex;

use crate::db::models::{ItemKind, ItemType};

static URL_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^(?:https?|ftp)://\S+$").unwrap());
static EMAIL_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$").unwrap());
static COMMAND_PREFIX_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)^(npm|pnpm|yarn|bun|npx|cargo|docker|docker-compose|compose|kubectl|helm|git|apt|apt-get|sudo|curl|wget|pip|pip3|pip install|go (run|build|mod|get)|brew|yay|pacman|systemctl|journalctl|ssh|scp|rsync|make|cmake|nmap|terraform|aws |gcloud |az )\b",
    )
    .unwrap()
});
static CODE_HINT_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?m)^\s*(const|let|var|function|async|await|import|export|return|def |class |impl |fn |interface|type |enum |struct |use |pub |SELECT|INSERT|UPDATE|DELETE|CREATE)\b|\b=>\b|\{[^}]*\};?\s*$",
    )
    .unwrap()
});
static JSON_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^\s*[\{\[]\s*$|^\s*[\}\]]\s*$").unwrap()
});

pub fn detect_type(kind: ItemKind, content: &str) -> ItemType {
    match kind {
        ItemKind::Image => return ItemType::Image,
        ItemKind::Html => {
            if let Some(plain) = strip_html(content) {
                if is_url(&plain) {
                    return ItemType::Url;
                }
            }
            return ItemType::Text;
        }
        ItemKind::Text => {}
    }

    let trimmed = content.trim();

    if trimmed.is_empty() {
        return ItemType::Text;
    }

    if URL_RE.is_match(trimmed) {
        return ItemType::Url;
    }
    if EMAIL_RE.is_match(trimmed) {
        return ItemType::Email;
    }
    if looks_like_json(trimmed) {
        return ItemType::Json;
    }
    if COMMAND_PREFIX_RE.is_match(trimmed) {
        return ItemType::Command;
    }
    if looks_like_code(trimmed) {
        return ItemType::Code;
    }
    ItemType::Text
}

fn looks_like_json(trimmed: &str) -> bool {
    if serde_json::from_str::<serde_json::Value>(trimmed).is_ok() {
        return true;
    }
    // multi-line JSON-ish block without trailing newline issues
    let lines: Vec<&str> = trimmed.lines().collect();
    if lines.len() >= 2 && JSON_RE.is_match(lines[0]) && JSON_RE.is_match(lines.last().unwrap_or(&"")) {
        return true;
    }
    false
}

fn looks_like_code(trimmed: &str) -> bool {
    let lines: Vec<&str> = trimmed.lines().collect();
    let multi_line = lines.len() > 1;
    if multi_line {
        let code_lines = lines
            .iter()
            .filter(|l| CODE_HINT_RE.is_match(l))
            .count();
        if code_lines >= 1 {
            return true;
        }
        // indented block (2+ spaces / tab) with 2+ lines
        let indented = lines
            .iter()
            .filter(|l| l.starts_with(' ') || l.starts_with('\t'))
            .count();
        if indented >= 2 {
            return true;
        }
    }
    // single line: code keyword, arrow, statement, or braced call/object
    if CODE_HINT_RE.is_match(trimmed) {
        return true;
    }
    if trimmed.contains("=>") || trimmed.contains(");") || trimmed.contains(';') {
        return true;
    }
    if trimmed.contains('{') && trimmed.contains('}') {
        return true;
    }
    false
}

fn is_url(s: &str) -> bool {
    URL_RE.is_match(s)
}

fn strip_html(html: &str) -> Option<String> {
    let re = Lazy::new(|| Regex::new(r"<[^>]+>").unwrap());
    let text = re.replace_all(html, " ").trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

// ------------------------------------------------------------- secrets

static SECRET_RE: Lazy<Vec<Regex>> = Lazy::new(|| {
    vec![
        // key=value / key: value
        Regex::new(
            r"(?i)\b(api[_-]?key|apikey|access[_-]?key|secret|secret[_-]?key|client[_-]?secret|token|auth[_-]?token|bearer|password|passwd|pwd|private[_-]?key|connection[_-]?string)\b\s*[=:]\s*\S+",
        )
        .unwrap(),
        // "key": "value"
        Regex::new(r#"(?i)["'](api[_-]?key|secret|token|password|passwd|private[_-]?key)["']\s*:\s*["'][^"']+["']"#)
            .unwrap(),
        // Bearer tokens
        Regex::new(r"(?i)\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b").unwrap(),
        // AWS access key
        Regex::new(r"\b(AKIA|ASIA)[0-9A-Z]{16}\b").unwrap(),
        // PEM private keys
        Regex::new(r"-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----").unwrap(),
        // OpenAI/Anthropic style keys
        Regex::new(r"\bsk-[A-Za-z0-9]{20,}\b").unwrap(),
        // GitHub tokens
        Regex::new(r"\bghp_[A-Za-z0-9]{36}\b").unwrap(),
        // Slack tokens
        Regex::new(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b").unwrap(),
        // JWT
        Regex::new(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b").unwrap(),
        // Postgres/MySQL full connection strings with password
        Regex::new(r"(?i)\b(postgres(ql)?|mysql|redis)://[^:\s/]+:[^@\s]+@\S+").unwrap(),
    ]
});

pub fn is_sensitive(content: &str) -> bool {
    for re in SECRET_RE.iter() {
        if re.is_match(content) {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_url() {
        assert_eq!(detect_type(ItemKind::Text, "https://github.com/foo/bar"), ItemType::Url);
        assert_eq!(detect_type(ItemKind::Text, "ftp://files.example.com/a"), ItemType::Url);
        assert_eq!(detect_type(ItemKind::Text, "not a url"), ItemType::Text);
    }

    #[test]
    fn detects_email() {
        assert_eq!(detect_type(ItemKind::Text, "duong@example.com"), ItemType::Email);
        assert_eq!(detect_type(ItemKind::Text, "foo+tag@sub.example.io"), ItemType::Email);
    }

    #[test]
    fn detects_json() {
        assert_eq!(detect_type(ItemKind::Text, "{\"name\": \"Duong\"}"), ItemType::Json);
        assert_eq!(detect_type(ItemKind::Text, "{\n  \"a\": 1,\n  \"b\": [1,2]\n}"), ItemType::Json);
        assert_eq!(detect_type(ItemKind::Text, "[1, 2, 3]"), ItemType::Json);
    }

    #[test]
    fn detects_command() {
        assert_eq!(detect_type(ItemKind::Text, "npm install @nestjs/common"), ItemType::Command);
        assert_eq!(detect_type(ItemKind::Text, "docker compose up -d"), ItemType::Command);
        assert_eq!(detect_type(ItemKind::Text, "git status"), ItemType::Command);
        assert_eq!(detect_type(ItemKind::Text, "sudo apt-get update"), ItemType::Command);
    }

    #[test]
    fn detects_code() {
        assert_eq!(detect_type(ItemKind::Text, "const user = await prisma.user.findUnique({ where: { id } })"), ItemType::Code);
        assert_eq!(detect_type(ItemKind::Text, "function add(a, b) {\n  return a + b;\n}"), ItemType::Code);
        assert_eq!(detect_type(ItemKind::Text, "    margin: 0 auto;\n    padding: 8px;"), ItemType::Code);
    }

    #[test]
    fn plain_text_stays_text() {
        assert_eq!(detect_type(ItemKind::Text, "hello world this is plain text"), ItemType::Text);
        assert_eq!(detect_type(ItemKind::Text, "PostgreSQL connection string"), ItemType::Text);
    }

    #[test]
    fn image_kind_always_image() {
        assert_eq!(detect_type(ItemKind::Image, "whatever"), ItemType::Image);
    }

    #[test]
    fn secret_detection() {
        assert!(is_sensitive("API_KEY=sk-1234567890abcdefghijklmnop"));
        assert!(is_sensitive("const token = \"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c\""));
        assert!(is_sensitive("Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.xXxXxXxXxXxXxXxXxXxXxXx"));
        assert!(is_sensitive("password=super-secret-123"));
        assert!(is_sensitive("AKIAIOSFODNN7EXAMPLE"));
        assert!(is_sensitive("-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA..."));
        assert!(is_sensitive("postgres://admin:pass123@db.example.com:5432/prod"));
        assert!(!is_sensitive("the token was revoked today at 12:00"));
        assert!(!is_sensitive("npm install @nestjs/common"));
    }
}
