// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Fallback: GTK_IM_MODULE trống trên một số distro làm IME (tiếng Việt)
    // preedit render ra cửa sổ đen tách rời (off-the-spot XIM). Ép về ibus.
    if std::env::var("GTK_IM_MODULE").is_err() {
        std::env::set_var("GTK_IM_MODULE", "ibus");
    }
    clipy_lib::run()
}
