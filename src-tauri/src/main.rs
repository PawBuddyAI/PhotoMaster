// 发布版不弹出额外的控制台窗口，不可删除
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    ai_photo_master_lib::run();
}
