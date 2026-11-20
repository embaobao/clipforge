//! macOS Vision FFI：同步识别本地图片文字（内置 OCR 的平台实现）。
//!
//! 通过 Objective-C runtime 动态取类，避免新增 Objective-C 绑定 crate；
//!   `VNImageRequestHandler` 的 `performRequests:error:` 是同步 API，
//!   调用方必须在 `spawn_blocking` 中执行，不能占用 Tauri async worker。

use std::ffi::CStr;

use tauri_nspanel::objc2::msg_send;
use tauri_nspanel::objc2::rc::{Allocated, Retained};
use tauri_nspanel::objc2::runtime::{AnyClass, AnyObject};
use tauri_nspanel::objc2_foundation::{NSArray, NSDictionary, NSString, NSURL};

#[link(name = "Vision", kind = "framework")]
extern "C" {}

fn vision_class(name: &'static CStr) -> Result<&'static AnyClass, String> {
    AnyClass::get(name).ok_or_else(|| {
        format!(
            "OCR_BUILTIN_UNAVAILABLE: Vision class {} missing",
            name.to_string_lossy()
        )
    })
}

/// 读取本地图片并返回按 Vision 观察顺序拼接的纯文本；空图返回空串。
/// 错误码：OCR_BUILTIN_UNAVAILABLE（系统缺类）/ OCR_BUILTIN_FAILED（识别失败）。
pub(crate) fn recognize_image(image_file: &str) -> Result<String, String> {
    let request_class = vision_class(c"VNRecognizeTextRequest")?;
    let handler_class = vision_class(c"VNImageRequestHandler")?;

    let request: Retained<AnyObject> = unsafe { msg_send![request_class, new] };
    // 关闭语言纠正：剪贴板内容常是代码/命令行，自动纠正会篡改原文。
    let _: () = unsafe { msg_send![&*request, setUsesLanguageCorrection: false] };
    let _: () = unsafe { msg_send![&*request, setRecognitionLevel: 0isize] };

    let path = NSString::from_str(image_file);
    let url = NSURL::fileURLWithPath(&path);
    let options = NSDictionary::<NSString, AnyObject>::new();
    let requests = NSArray::arrayWithObject(&*request);

    let allocated: Allocated<AnyObject> = unsafe { msg_send![handler_class, alloc] };
    let handler: Retained<AnyObject> = unsafe {
        msg_send![
            allocated,
            initWithURL: &*url,
            options: &*options
        ]
    };
    let result: Result<(), Retained<tauri_nspanel::objc2_foundation::NSError>> = unsafe {
        msg_send![
            &*handler,
            performRequests: &*requests,
            error: _
        ]
    };
    result.map_err(|error| {
        // 只取错误码，绝不把图片路径或系统错误详情返回前端（前端按白名单文案展示）。
        let code = error.code();
        format!("OCR_BUILTIN_FAILED: Vision performRequests failed ({code})")
    })?;

    let observations: Option<Retained<NSArray<AnyObject>>> =
        unsafe { msg_send![&*request, results] };
    let Some(observations) = observations else {
        return Ok(String::new());
    };

    let mut lines = Vec::with_capacity(observations.len());
    for index in 0..observations.len() {
        let observation = observations.objectAtIndex(index);
        let candidates: Option<Retained<NSArray<AnyObject>>> =
            unsafe { msg_send![&*observation, topCandidates: 1usize] };
        let Some(candidate) = candidates.and_then(|items| items.firstObject()) else {
            continue;
        };
        let text: Retained<NSString> = unsafe { msg_send![&*candidate, string] };
        let line = text.to_string();
        if !line.trim().is_empty() {
            lines.push(line.trim().to_string());
        }
    }
    Ok(lines.join("\n"))
}
