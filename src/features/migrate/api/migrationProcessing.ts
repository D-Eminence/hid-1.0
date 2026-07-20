import {supabase} from '../../../lib/supabase'
export type ProcessingJob={id:string;source_folder_id:string|null;job_type:'security_scan'|'image_process'|'ocr';status:string;provider:string|null;attempt_count:number;max_attempts:number;last_error_code:string|null;last_error_message:string|null;created_at:string}
export type ProcessingFolder={id:string;folder_reference:string;status:string;created_at:string;assets:Array<{id:string;status:string}>}
async function invoke<T>(name:string,options:Parameters<typeof supabase.functions.invoke>[1]){
 const result=await supabase.functions.invoke(name,options);if(result.error)throw new Error(result.error.message);return result.data as T
}
export async function listProcessing<T>(projectId:string,resource:'jobs'|'folders'|'intelligence'='jobs'){
 return invoke<{data:T[];page:{next_cursor:string|null}}>(`migration-processing?project_id=${encodeURIComponent(projectId)}&resource=${resource}&limit=100`,{method:'GET'})
}
export async function processingCommand<T>(projectId:string,action:string,payload:Record<string,unknown>){
 const result=await invoke<{data:T}>('migration-processing',{method:'POST',body:{project_id:projectId,action,...payload}});return result.data
}
