export interface BuildApiOptions {
  noHtmlPipe?: boolean;
  noPostprocess?: boolean;
  password?: string;
}

export interface BuildProvenance {
  author?: string;
  remark?: string;
  title?: string;
}

export interface BuildEntry {
  relPath: string;
  contentBase64: string;
}

export interface BuildRequestBody {
  markdown?: string;
  entries?: BuildEntry[];
  mdRelPath?: string;
  templateId?: string;
  fileName?: string;
  options?: BuildApiOptions;
  provenance?: BuildProvenance;
}
