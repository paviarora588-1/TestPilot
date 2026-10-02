export type Platform = 'SAP GUI' | 'Web' | 'Desktop' | 'Hybrid' | string;
export type Status = string;

export interface Product {
  id: number;
  name: string;
  product_type?: Platform;
  type?: Platform;
  environment: string;
  entry_point?: string;
  entryPoint?: string;
  app_path_or_url?: string;
  appPathOrUrl?: string;
  default_framework?: string;
  framework?: string;
  owner: string;
  description: string;
  business_criticality?: string;
  automation_risk_level?: string;
  readiness_score?: number;
  readiness?: number;
}

export interface KnowledgeSource {
  id: number;
  product_id: number;
  name: string;
  source_type: string;
  status: string;
  original_filename?: string;
  filename?: string;
  file_type?: string;
  file_size?: number;
  content_type?: string;
  preview?: string;
  error_message?: string;
  processed_at?: string;
  created_at?: string;
}

export interface KnowledgeChunk {
  id: number;
  source_id: number;
  product_id: number;
  chunk_index: number;
  content: string;
  chunk_text?: string;
  tags?: string[];
  embedding_text?: string;
  metadata?: Record<string, unknown>;
}

export interface KnowledgeSummary {
  product_id: number;
  readiness: number;
  modules: string[];
  features: string[];
  modules_detected_list?: string[];
  features_detected_list?: string[];
  business_rules: string[];
  validations: string[];
  expected_messages: string[];
  gaps: string[];
  missing_gaps?: string[];
  what_ai_learned?: string[];
  what_ai_is_unsure_about?: string[];
  suggestions: string[];
  documents_uploaded: number;
  chunks_created: number;
  modules_detected: number;
  features_detected: number;
  business_rules_extracted: number;
  ai_warning?: string;
}

export interface RepositoryObject {
  id: number;
  product_id?: number;
  object_name?: string;
  objectName?: string;
  platform: Platform;
  product?: string;
  module: string;
  area_or_tab?: string;
  areaOrTab?: string;
  feature: string;
  screen: string;
  screen_type?: string;
  screenType?: string;
  object_type?: string;
  objectType?: string;
  technical_path?: string;
  locator?: string;
  locator_strategy?: string;
  locatorStrategy?: string;
  supported_actions?: string[];
  supportedActions?: string[];
  scope?: string;
  parent_screen_id?: number | null;
  parentScreenId?: number | null;
  parent_object_id?: number | null;
  parentObjectId?: number | null;
  verification_status?: string;
  verificationStatus?: string;
  captured_from?: string;
  capturedFrom?: string;
  notes?: string;
  status: Status;
  confidence: number;
  aliases: string[];
  last_verified?: string;
  lastVerified?: string;
  path_history?: Array<Record<string, string>>;
}

export interface TestCase {
  id: number;
  product_id?: number;
  external_id?: string;
  externalId?: string;
  title: string;
  module: string;
  feature: string;
  source: string;
  priority?: string;
  steps: number;
  step_items?: Array<{ id: number; order: number; instruction: string; expected_result?: string }>;
  stepItems?: Array<{ id: number; order: number; instruction: string; expectedResult?: string }>;
  expected_result?: string;
  expectedResult?: string;
  readiness: number;
  automation_readiness?: number;
  quality_score?: number;
  qualityScore?: number;
  risk_score?: number;
  riskScore?: number;
  status: Status;
  analysis_result?: Record<string, unknown>;
  analysisResult?: Record<string, unknown>;
}

export interface MappingRow {
  id: number;
  manual_step?: string;
  manualStep?: string;
  ai_understanding?: string;
  aiUnderstanding?: string;
  mapped_object?: string;
  mappedObject?: string;
  mapped_object_id?: number | null;
  automation_action?: string;
  action?: string;
  test_data?: string;
  expected_result?: string;
  confidence: number;
  risk_score?: number;
  riskScore?: number;
  selected_reason?: string;
  alternative_objects?: string[];
  status: Status;
  approved?: boolean;
}

export interface GeneratedScript {
  id: number;
  product_id: number;
  test_case_id: number;
  framework: string;
  code: string;
  file_name?: string;
  fileName?: string;
  command: string;
  review_json?: Record<string, unknown>;
  risk_score?: number;
  status?: string;
  review_status?: string;
  download_url?: string;
}

export interface ExecutionRun {
  id: number;
  product_id: number;
  script_id: number;
  status: string;
  command: string;
  logs: string[];
  evidence_path?: string;
  failure_analysis_json?: Record<string, unknown>;
  step_results?: Array<{ order: number; action: string; instruction?: string; status: string; message: string }>;
}

export interface AutoHealSuggestion {
  id: number;
  product_id: number;
  object: string;
  platform: string;
  old_path: string;
  suggested_path: string;
  reason: string;
  confidence: number;
  risk_score?: number;
  status: string;
}

export interface HistoryEvent {
  id?: number;
  time: string;
  actor: 'User' | 'TestPilot Agent' | string;
  action: string;
  entity?: string;
  entity_type?: string;
  entity_id?: string;
  status: Status;
  details: string;
  before?: string;
  after?: string;
  before_value?: string;
  after_value?: string;
}
