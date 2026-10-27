    use super::{
        build_clipboard_write_plan, ClipboardWriteData, ClipboardWriteMode, ClipboardWritePlan,
    };
    use crate::{
        CaptureContextPayload, ClipAnalysisPayload, ClipItemPayload, ClipboardRepresentationPayload,
    };
    use serde_json::json;

    fn test_item(primary_format: &str, content: &str) -> ClipItemPayload {
        let content_hash = crate::content_hash(primary_format, content.as_bytes());
        ClipItemPayload {
            id: "clip-test".to_string(),
            content: content.to_string(),
            content_hash: content_hash.clone(),
            created_at: 1,
            updated_at: 1,
            last_seen_at: 1,
            last_copied_at: None,
            source: "clipboard".to_string(),
            kind: "text".to_string(),
            bucket: "history".to_string(),
            favorite: false,
            tags: Vec::new(),
            copy_count: 0,
            analysis: ClipAnalysisPayload {
                source_name: "Unit".to_string(),
                badge: "TXT".to_string(),
                title: "Unit clip".to_string(),
                summary: "Unit summary".to_string(),
                url: None,
                host: None,
                is_markdown: false,
            },
            payload_kind: "text".to_string(),
            primary_format: primary_format.to_string(),
            available_formats: vec![primary_format.to_string()],
            representations: vec![ClipboardRepresentationPayload {
                format: primary_format.to_string(),
                storage: "inline".to_string(),
                content: Some(content.to_string()),
                file_name: None,
                size: Some(content.len() as i64),
                hash: Some(content_hash),
                preferred: true,
            }],
            plain_text: "plain fallback".to_string(),
            search_text: Some("plain search".to_string()),
            sub_kind: None,
            width: None,
            height: None,
            size: Some(content.len() as i64),
            file_types: None,
            thumbnail_path: None,
            image_file: None,
            is_sensitive: false,
            capture_context: CaptureContextPayload {
                schema_version: 1,
                surface: "unit-test".to_string(),
                source_label: "Unit Test".to_string(),
                source_app: None,
                application_context: None,
                collectors: json!({ "status": "not-requested", "results": [], "diagnostics": [] }),
                observed_at: 1,
                primary_format: primary_format.to_string(),
                available_formats: vec![primary_format.to_string()],
                environment: json!({ "platform": "test" }),
            },
            metadata: json!({}),
            agent_context: json!({}),
            source_app: None,
        }
    }

    fn entry_text(plan: &ClipboardWritePlan, format: &str) -> Option<String> {
        plan.entries
            .iter()
            .find_map(|entry| match (&entry.format, &entry.data) {
                (entry_format, ClipboardWriteData::Text(text)) if entry_format == format => {
                    Some(text.clone())
                }
                _ => None,
            })
    }

    #[test]
    fn html_rich_plan_writes_plain_and_html() {
        let item = test_item("text/html", "<b>Hello</b>");

        let plan = build_clipboard_write_plan(&item, None).expect("html write plan");

        assert_eq!(plan.mode, ClipboardWriteMode::RichText);
        assert_eq!(plan.written_formats(), vec!["text/plain", "text/html"]);
        assert_eq!(
            entry_text(&plan, "text/plain"),
            Some("plain search".to_string())
        );
        assert_eq!(
            entry_text(&plan, "text/html"),
            Some("<b>Hello</b>".to_string())
        );
        assert_eq!(plan.guard_hash, item.content_hash);
    }

    #[test]
    fn plain_mode_for_html_writes_plain_only_with_plain_hash() {
        let item = test_item("text/html", "<b>Hello</b>");

        let plan = build_clipboard_write_plan(&item, Some("plain")).expect("plain write plan");

        assert_eq!(plan.mode, ClipboardWriteMode::PlainText);
        assert_eq!(plan.written_formats(), vec!["text/plain"]);
        assert_eq!(
            entry_text(&plan, "text/plain"),
            Some("plain search".to_string())
        );
        assert_eq!(
            plan.guard_hash,
            crate::content_hash("text/plain", "plain search".as_bytes())
        );
    }

    #[test]
    fn rtf_rich_plan_writes_plain_and_rtf() {
        let item = test_item("text/rtf", "{\\rtf1 Hello}");

        let plan = build_clipboard_write_plan(&item, None).expect("rtf write plan");

        assert_eq!(plan.mode, ClipboardWriteMode::RichText);
        assert_eq!(plan.written_formats(), vec!["text/plain", "text/rtf"]);
        assert_eq!(
            entry_text(&plan, "text/rtf"),
            Some("{\\rtf1 Hello}".to_string())
        );
    }

    #[test]
    fn image_plan_uses_image_file_without_touching_clipboard() {
        let mut item = test_item("image/png", "image.png");
        item.image_file = Some("/tmp/clipforge-image.png".to_string());
        item.plain_text = "Image 2x3".to_string();

        let plan = build_clipboard_write_plan(&item, None).expect("image write plan");

        assert_eq!(plan.mode, ClipboardWriteMode::Image);
        assert_eq!(plan.written_formats(), vec!["image/png"]);
        assert_eq!(plan.text_fallback, "Image 2x3");
        assert_eq!(
            plan.entries[0].data,
            ClipboardWriteData::ImageFile("/tmp/clipforge-image.png".to_string())
        );
    }

    #[test]
    fn file_rich_and_path_modes_share_standard_entries() {
        let mut item = test_item("application/file-list", "/tmp/a.txt\n/tmp/b.md\n");
        item.plain_text = "/tmp/a.txt\n/tmp/b.md\n".to_string();
        item.search_text = Some("a.txt\nb.md".to_string());

        let rich = build_clipboard_write_plan(&item, None).expect("file write plan");
        assert_eq!(rich.mode, ClipboardWriteMode::Files);
        assert_eq!(rich.written_formats(), vec!["application/file-list"]);
        assert_eq!(
            rich.entries[0].data,
            ClipboardWriteData::FileList(vec!["/tmp/a.txt".to_string(), "/tmp/b.md".to_string()])
        );

        let paths =
            build_clipboard_write_plan(&item, Some("filesAsPaths")).expect("path write plan");
        assert_eq!(paths.mode, ClipboardWriteMode::PlainText);
        assert_eq!(paths.written_formats(), vec!["text/plain"]);
        // 复制为路径必须给完整路径（search_text 存的展示文件名不是路径语义）。
        assert_eq!(
            entry_text(&paths, "text/plain"),
            Some("/tmp/a.txt\n/tmp/b.md".to_string())
        );
    }

    #[test]
    fn text_only_path_representation_stays_plain_text() {
        let path = "/Users/me/project/proposal.md";
        let mut item = test_item("text/plain", path);
        item.primary_format = "application/file-list".to_string();
        item.payload_kind = "file".to_string();
        item.available_formats = vec![
            "application/file-list".to_string(),
            "text/plain".to_string(),
        ];
        item.representations[0].preferred = false;
        item.plain_text = path.to_string();
        item.search_text = Some(path.to_string());
        let plan = build_clipboard_write_plan(&item, None).expect("legacy text path write plan");
        assert_eq!(plan.mode, ClipboardWriteMode::PlainText);
        assert_eq!(plan.written_formats(), vec!["text/plain"]);
        assert_eq!(entry_text(&plan, "text/plain"), Some(path.to_string()));
    }
