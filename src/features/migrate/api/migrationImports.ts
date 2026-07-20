import{supabase}from'../../../lib/supabase'
export type ImportItem={id:string;source_folder_id:string;status:string;attempt_count:number;target_record_ids:string[];last_error_message:string|null;verified_at:string|null;patient:{hid_code:string;full_name:string}|null}
export type ImportJob={id:string;status:string;idempotency_key:string;total_items:number;succeeded_items:number;failed_items:number;created_at:string;items:ImportItem[]}
async function invoke<T>(name:string,options:Parameters<typeof supabase.functions.invoke>[1]){const result=await supabase.functions.invoke(name,options);if(result.error)throw new Error(result.error.message);return result.data as T}
export async function listImports(projectId:string){return invoke<{data:ImportJob[];page:{next_cursor:string|null}}>(`migration-imports?project_id=${encodeURIComponent(projectId)}`,{method:'GET'})}
export async function importCommand<T>(projectId:string,action:string,payload:Record<string,unknown>={}){return invoke<{data:T}>('migration-imports',{method:'POST',body:{project_id:projectId,action,...payload}})}
