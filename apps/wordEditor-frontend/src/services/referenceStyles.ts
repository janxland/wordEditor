export interface ReferenceStyleFonts {
  ascii?: string;
  hAnsi?: string;
  cs?: string;
  eastAsia?: string;
}

export interface ReferenceStyleRun {
  fonts?: ReferenceStyleFonts;
  size_pt?: number;
  size_half_pt?: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  underline?: string;
}

export interface ReferenceStyleSpacing {
  line_multi?: number;
  line_pt?: number;
  line_rule?: string;
  before_pt?: number;
  after_pt?: number;
}

export interface ReferenceStyleParagraph {
  align?: string;
  spacing?: ReferenceStyleSpacing;
  indent?: Record<string, number | string>;
  outline_level?: number;
}

export interface ReferenceStyle {
  styleId: string;
  name: string;
  type: 'paragraph' | 'character' | 'table' | 'numbering' | string;
  isDefault: boolean;
  isCustom: boolean;
  basedOn: string;
  next: string;
  link: string;
  uiPriority: number | null;
  qFormat: boolean;
  hidden: boolean;
  run: ReferenceStyleRun;
  paragraph: ReferenceStyleParagraph;
  runSummary: string;
  paragraphSummary: string;
}

export interface ReferenceStylesResponse {
  docx: string;
  count: number;
  styles: ReferenceStyle[];
}

export async function fetchReferenceStyles(
  templateId: string,
  baseUrl = '/api',
): Promise<ReferenceStylesResponse> {
  const res = await fetch(
    `${baseUrl}/templates/reference-styles?template=${encodeURIComponent(templateId)}`,
  );
  const data = (await res.json()) as ReferenceStylesResponse & { error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
  return data;
}
