export type OcrRequest={jobId:string;sourceUrl:string;mimeType:string;languages:string[]}
export type OcrBlock={text:string;confidence:number|null;polygon:number[];pageNumber:number}
export type OcrResult={provider:string;model:string;requestId:string|null;text:string;confidence:number|null;blocks:OcrBlock[];tables:unknown[];rawResult:unknown;latencyMs:number;costMinor:number|null}
export interface MigrationOcrAdapter{
 readonly provider:string
 submit(request:OcrRequest):Promise<{requestId:string}>
 poll(requestId:string):Promise<{status:'running'|'succeeded'|'failed';result?:OcrResult;errorCode?:string}>
 estimateCost(pageCount:number):Promise<number|null>
}

export function assertNormalizedOcrResult(value:OcrResult){
 if(!value.provider||!value.model||typeof value.text!=='string'||!Array.isArray(value.blocks)||!Array.isArray(value.tables)){
  throw new Error('OCR adapter returned an invalid normalized result.')
 }
 if(value.confidence!=null&&(value.confidence<0||value.confidence>1))throw new Error('OCR confidence is outside 0..1.')
 return value
}
