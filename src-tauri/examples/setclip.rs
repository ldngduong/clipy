fn main() {
    let text = std::env::args().nth(1).unwrap_or_else(|| "setclip default".to_string());
    let mut clip = arboard::Clipboard::new().expect("clipboard init");
    clip.set_text(&text).expect("set text");
    println!("clipboard set to: {text}");
}
