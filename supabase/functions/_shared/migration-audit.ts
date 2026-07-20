type Client={from:(table:string)=>any}
export async function logMigrationAudit(client:Client,input:{actorUserId:string;actorProfileId:string|null;actorRole:string|null;organizationId:string;projectId:string;resourceType:string;resourceId?:string|null;action:string;reason?:string|null;correlationId?:string|null;metadata?:Record<string,unknown>}){
 const result=await client.from('hid_audit_events').insert({
  actor_user_id:input.actorUserId,actor_profile_id:input.actorProfileId,actor_role:input.actorRole,
  organization_id:input.organizationId,resource_type:input.resourceType,resource_id:input.resourceId??null,
  action:input.action,reason:input.reason??null,request_id:input.correlationId??null,
  metadata:{migration_project_id:input.projectId,...(input.metadata??{})},
 })
 if(result.error)throw result.error
}
