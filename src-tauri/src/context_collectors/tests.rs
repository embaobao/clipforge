use super::{collector_catalog, collector_matches, validate_collector_output, CollectorMatcher};
use serde_json::json;

#[test]
fn contract_describes_external_execution_boundary() {
    let catalog = collector_catalog();
    assert_eq!(catalog["protocol"], "clipforge.application-context.collector.v1");
    assert_eq!(catalog["safety"]["shell"], false);
    assert_eq!(catalog["externalAdapter"]["example"]["id"], "browser.chrome.example");
}

#[test]
fn matcher_requires_declared_application_selector() {
    let matcher = CollectorMatcher {
        bundle_ids: vec!["com.google.Chrome".to_string()],
        app_names: Vec::new(),
    };
    assert!(collector_matches(
        &matcher,
        &json!({ "application": { "bundleId": "com.google.chrome" } })
    ));
    assert!(!collector_matches(
        &matcher,
        &json!({ "application": { "bundleId": "com.apple.Safari" } })
    ));
}

#[test]
fn output_validation_reports_missing_contract_fields() {
    let validation = validate_collector_output(&json!({ "context": {} }));
    assert_eq!(validation["valid"], false);
    assert!(validation["errors"].as_array().unwrap().len() >= 3);
}

