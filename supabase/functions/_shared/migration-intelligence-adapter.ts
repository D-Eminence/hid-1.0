export type SourceSpan={page_id:string;start:number;end:number;polygon?:number[]}
export type ExtractedField={value:unknown;confidence:number|null;source_spans:SourceSpan[]}
export type ClassificationCandidate={category:string;confidence:number}
export type ClassificationResult={selected_category:string;candidates:ClassificationCandidate[];confidence:number|null;provider:string;model:string;prompt_version:string;schema_version:string}
export type ExtractionResult={document_category:string;schema_name:string;schema_version:string;provider:string;model:string;prompt_version:string;fields:Record<string,ExtractedField>;overall_confidence:number|null}
export interface MigrationIntelligenceAdapter{
 classify(input:{document_id:string;ocr_text:string}):Promise<ClassificationResult>
 extract(input:{document_id:string;ocr_text:string;classification:ClassificationResult}):Promise<ExtractionResult>
}
export function assertExtraction(result:ExtractionResult){
 for(const [name,field] of Object.entries(result.fields)){
  if(!name||!Array.isArray(field.source_spans)||field.source_spans.length===0)throw new Error(`Extraction field ${name} has no source lineage.`)
  if(field.confidence!=null&&(field.confidence<0||field.confidence>1))throw new Error(`Extraction field ${name} has invalid confidence.`)
 }
 return result
}
