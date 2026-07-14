import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../common/database.service';

type EvaluationInput = { haid: string; easeScore: number; punctualityScore: number; qualityScore: number; tranquilityScore: number; comment?: string; reportProblem?: boolean; problemCategoryCode?: string };
type IncidentInput = { haid: string; orderCode?: string; categoryCode: string; severity: string; description: string; assignedUserCode?: string; dueAt?: string };
type ListInput = { status?: string; severity?: string; cppCode?: string; assignedUserCode?: string; haid?: string };

@Injectable()
export class ExperienceService {
  constructor(private readonly db: DatabaseService) {}

  private async nextCode(client: PoolClient, sequenceCode: string): Promise<string> {
    const result = await client.query<{ current_value: string; prefix: string; padding: number }>(
      `UPDATE core.business_sequences SET current_value=current_value+1,updated_at=NOW()
       WHERE sequence_code=$1 RETURNING current_value,prefix,padding`, [sequenceCode],
    );
    const row = result.rows[0]; if (!row) throw new Error(`${sequenceCode} sequence missing`);
    return `${row.prefix}${String(row.current_value).padStart(row.padding, '0')}`;
  }

  private async resolveUser(client: PoolClient, userCode?: string): Promise<string | null> {
    if (!userCode) return null;
    const result = await client.query<{ id: string }>(`SELECT id FROM core.internal_users WHERE user_code=$1 AND is_active=TRUE`, [userCode]);
    if (!result.rows[0]) throw new NotFoundException('EXPERIENCE_USER_NOT_FOUND');
    return result.rows[0].id;
  }

  async createEvaluation(orderCode: string, input: EvaluationInput) {
    return this.db.transaction(async (client) => {
      const orderResult = await client.query<any>(
        `SELECT o.id,o.household_id,o.cpp_id,o.status_code,h.haid,d.id delivery_id,d.status_code delivery_status
         FROM commerce.orders o JOIN household.households h ON h.id=o.household_id
         LEFT JOIN logistics.deliveries d ON d.order_id=o.id
         WHERE o.order_code=$1 FOR UPDATE OF o`, [orderCode],
      );
      const order = orderResult.rows[0]; if (!order) throw new NotFoundException('ORDER_NOT_FOUND');
      if (order.haid !== input.haid) throw new UnprocessableEntityException('ORDER_NOT_IN_HOUSEHOLD');
      if (order.status_code !== 'DELIVERED' || order.delivery_status !== 'DELIVERED') throw new ConflictException('ORDER_NOT_DELIVERED');
      const exists = await client.query(`SELECT 1 FROM experience.evaluations WHERE order_id=$1`, [order.id]);
      if (exists.rows[0]) throw new ConflictException('EVALUATION_ALREADY_EXISTS');
      const lowScore = Math.min(input.easeScore, input.punctualityScore, input.qualityScore, input.tranquilityScore) <= 2;
      const requiresFollowUp = Boolean(input.reportProblem || lowScore);
      const evaluationId = randomUUID(); const evaluationCode = await this.nextCode(client, 'EXPERIENCE_EVALUATION');
      await client.query(
        `INSERT INTO experience.evaluations(id,evaluation_code,order_id,delivery_id,household_id,ease_score,punctuality_score,
          quality_score,tranquility_score,comment,requires_follow_up)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [evaluationId,evaluationCode,order.id,order.delivery_id,order.household_id,input.easeScore,input.punctualityScore,
          input.qualityScore,input.tranquilityScore,input.comment ?? null,requiresFollowUp],
      );
      let incidentCode: string | null = null;
      if (requiresFollowUp) {
        const incident = await this.createIncidentWithClient(client, {
          haid: input.haid, orderCode, categoryCode: input.problemCategoryCode ?? (lowScore ? 'LOW_EXPERIENCE_SCORE' : 'HOUSEHOLD_REPORTED_PROBLEM'),
          severity: lowScore ? 'HIGH' : 'MEDIUM', description: input.comment?.trim() || 'El Hogar solicitó seguimiento después de la entrega.',
        }, evaluationId);
        incidentCode = incident.incidentCode;
      }
      await this.auditAndEvent(client, { action: 'EXPERIENCE_EVALUATION_CREATED', eventType: 'experience.evaluation_created', entityType: 'EXPERIENCE_EVALUATION',
        entityId: evaluationId, businessCode: evaluationCode, payload: { evaluationCode, orderCode, haid: input.haid, requiresFollowUp, incidentCode } });
      return { success: true, data: { evaluationCode, orderCode, requiresFollowUp, incidentCode }, meta: { timestamp: new Date().toISOString() } };
    });
  }

  async listHouseholdEvaluations(haid: string) {
    const result = await this.db.query<any>(
      `SELECT e.evaluation_code,o.order_code,e.ease_score,e.punctuality_score,e.quality_score,e.tranquility_score,e.comment,
              e.requires_follow_up,e.submitted_at
       FROM experience.evaluations e JOIN household.households h ON h.id=e.household_id
       JOIN commerce.orders o ON o.id=e.order_id WHERE h.haid=$1 ORDER BY e.submitted_at DESC`, [haid],
    );
    return { success: true, data: result.rows.map((r: any) => ({ evaluationCode:r.evaluation_code,orderCode:r.order_code,easeScore:r.ease_score,
      punctualityScore:r.punctuality_score,qualityScore:r.quality_score,tranquilityScore:r.tranquility_score,comment:r.comment,
      requiresFollowUp:r.requires_follow_up,submittedAt:r.submitted_at })), meta:{timestamp:new Date().toISOString()} };
  }

  async createIncident(input: IncidentInput) {
    return this.db.transaction(async (client) => {
      const data = await this.createIncidentWithClient(client, input);
      return { success: true, data, meta: { timestamp: new Date().toISOString() } };
    });
  }

  private async createIncidentWithClient(client: PoolClient, input: IncidentInput, evaluationId?: string) {
    const householdResult = await client.query<{ id: string }>(`SELECT id FROM household.households WHERE haid=$1 AND is_active=TRUE`, [input.haid]);
    const household = householdResult.rows[0]; if (!household) throw new NotFoundException('HOUSEHOLD_NOT_FOUND');
    let order: any = null;
    if (input.orderCode) {
      const orderResult = await client.query<any>(
        `SELECT o.id,o.household_id,o.cpp_id,d.id delivery_id FROM commerce.orders o
         LEFT JOIN logistics.deliveries d ON d.order_id=o.id WHERE o.order_code=$1`, [input.orderCode],
      );
      order = orderResult.rows[0]; if (!order) throw new NotFoundException('ORDER_NOT_FOUND');
      if (order.household_id !== household.id) throw new UnprocessableEntityException('ORDER_NOT_IN_HOUSEHOLD');
    }
    const assignedUserId = await this.resolveUser(client, input.assignedUserCode);
    if (input.dueAt && Number.isNaN(new Date(input.dueAt).getTime())) throw new BadRequestException('INVALID_DUE_AT');
    const incidentId = randomUUID(); const incidentCode = await this.nextCode(client, 'SERVICE_INCIDENT');
    await client.query(
      `INSERT INTO experience.incidents(id,incident_code,household_id,order_id,delivery_id,cpp_id,evaluation_id,category_code,severity_code,
        source_code,description,assigned_user_id,due_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::timestamptz)`,
      [incidentId,incidentCode,household.id,order?.id ?? null,order?.delivery_id ?? null,order?.cpp_id ?? null,evaluationId ?? null,
        input.categoryCode,input.severity,evaluationId ? 'EVALUATION' : 'MANUAL',input.description,assignedUserId,input.dueAt ?? null],
    );
    await this.auditAndEvent(client, { action:'SERVICE_INCIDENT_CREATED',eventType:'experience.incident_created',entityType:'SERVICE_INCIDENT',entityId:incidentId,
      businessCode:incidentCode,payload:{incidentCode,haid:input.haid,orderCode:input.orderCode ?? null,categoryCode:input.categoryCode,severity:input.severity} });
    return { incidentCode, status:'OPEN', assignedUserCode:input.assignedUserCode ?? null };
  }

  async listIncidents(input: ListInput) {
    const params: unknown[]=[]; const filters:string[]=[];
    const add=(fragment:string,value:unknown)=>{params.push(value);filters.push(fragment.replace('?',`$${params.length}`));};
    if(input.status)add('i.status_code=?',input.status);
    if(input.severity)add('i.severity_code=?',input.severity);
    if(input.cppCode)add('c.cpp_code=?',input.cppCode);
    if(input.assignedUserCode)add('u.user_code=?',input.assignedUserCode);
    if(input.haid)add('h.haid=?',input.haid);
    const result=await this.db.query<any>(
      `SELECT i.incident_code,i.category_code,i.severity_code,i.source_code,i.status_code,i.description,i.opened_at,i.due_at,
              i.resolved_at,i.closed_at,h.haid,h.household_name,o.order_code,c.cpp_code,u.user_code assigned_user_code
       FROM experience.incidents i JOIN household.households h ON h.id=i.household_id
       LEFT JOIN commerce.orders o ON o.id=i.order_id LEFT JOIN operations.cpp c ON c.id=i.cpp_id
       LEFT JOIN core.internal_users u ON u.id=i.assigned_user_id
       ${filters.length?`WHERE ${filters.join(' AND ')}`:''} ORDER BY CASE i.severity_code WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,i.opened_at`,params);
    return {success:true,data:result.rows.map((r:any)=>({incidentCode:r.incident_code,categoryCode:r.category_code,severity:r.severity_code,
      source:r.source_code,status:r.status_code,description:r.description,openedAt:r.opened_at,dueAt:r.due_at,resolvedAt:r.resolved_at,
      closedAt:r.closed_at,haid:r.haid,householdName:r.household_name,orderCode:r.order_code,cppCode:r.cpp_code,assignedUserCode:r.assigned_user_code})),meta:{timestamp:new Date().toISOString()}};
  }

  async getIncident(code:string){return this.db.transaction((client)=>this.getIncidentWithClient(client,code));}

  async assignIncident(code:string,input:{assignedUserCode:string;note?:string}){
    return this.db.transaction(async(client)=>{
      const incident=await this.lockIncident(client,code); const userId=await this.resolveUser(client,input.assignedUserCode);
      if(['RESOLVED','CLOSED'].includes(incident.status_code))throw new ConflictException('INCIDENT_ALREADY_FINAL');
      await client.query(`UPDATE experience.incidents SET assigned_user_id=$2,status_code=CASE WHEN status_code='OPEN' THEN 'ACKNOWLEDGED' ELSE status_code END,
        acknowledged_at=COALESCE(acknowledged_at,NOW()),updated_at=NOW(),version=version+1 WHERE id=$1`,[incident.id,userId]);
      await this.insertUpdate(client,incident.id,'ASSIGNMENT',input.note ?? `Asignado a ${input.assignedUserCode}`,incident.status_code,incident.status_code==='OPEN'?'ACKNOWLEDGED':incident.status_code,userId);
      await this.auditAndEvent(client,{action:'SERVICE_INCIDENT_ASSIGNED',eventType:'experience.incident_assigned',entityType:'SERVICE_INCIDENT',entityId:incident.id,businessCode:code,payload:{incidentCode:code,assignedUserCode:input.assignedUserCode}});
      return this.getIncidentWithClient(client,code);
    });
  }

  async addUpdate(code:string,input:{note:string;status?:string;userCode?:string}){
    return this.db.transaction(async(client)=>{
      const incident=await this.lockIncident(client,code); const userId=await this.resolveUser(client,input.userCode);
      if(incident.status_code==='CLOSED')throw new ConflictException('INCIDENT_CLOSED');
      const next=input.status ?? incident.status_code;
      if(next==='CLOSED')throw new BadRequestException('USE_CLOSE_ENDPOINT');
      await client.query(`UPDATE experience.incidents SET status_code=$2,acknowledged_at=CASE WHEN $2 IN ('ACKNOWLEDGED','IN_PROGRESS') THEN COALESCE(acknowledged_at,NOW()) ELSE acknowledged_at END,
        updated_at=NOW(),version=version+1 WHERE id=$1`,[incident.id,next]);
      await this.insertUpdate(client,incident.id,'FOLLOW_UP',input.note,incident.status_code,next,userId);
      await this.auditAndEvent(client,{action:'SERVICE_INCIDENT_UPDATED',eventType:'experience.incident_updated',entityType:'SERVICE_INCIDENT',entityId:incident.id,businessCode:code,payload:{incidentCode:code,status:next}});
      return this.getIncidentWithClient(client,code);
    });
  }

  async resolveIncident(code:string,input:{resolutionSummary:string;rootCauseCode?:string;userCode?:string}){
    return this.db.transaction(async(client)=>{
      const incident=await this.lockIncident(client,code); const userId=await this.resolveUser(client,input.userCode);
      if(incident.status_code==='CLOSED')throw new ConflictException('INCIDENT_CLOSED');
      await client.query(`UPDATE experience.incidents SET status_code='RESOLVED',resolution_summary=$2,root_cause_code=$3,resolved_at=NOW(),updated_at=NOW(),version=version+1 WHERE id=$1`,
        [incident.id,input.resolutionSummary,input.rootCauseCode ?? null]);
      await this.insertUpdate(client,incident.id,'RESOLUTION',input.resolutionSummary,incident.status_code,'RESOLVED',userId);
      await this.auditAndEvent(client,{action:'SERVICE_INCIDENT_RESOLVED',eventType:'experience.incident_resolved',entityType:'SERVICE_INCIDENT',entityId:incident.id,businessCode:code,payload:{incidentCode:code,rootCauseCode:input.rootCauseCode ?? null}});
      return this.getIncidentWithClient(client,code);
    });
  }

  async closeIncident(code:string,input:{note:string;userCode?:string}){
    return this.db.transaction(async(client)=>{
      const incident=await this.lockIncident(client,code); const userId=await this.resolveUser(client,input.userCode);
      if(incident.status_code!=='RESOLVED')throw new ConflictException('INCIDENT_MUST_BE_RESOLVED');
      await client.query(`UPDATE experience.incidents SET status_code='CLOSED',closed_at=NOW(),updated_at=NOW(),version=version+1 WHERE id=$1`,[incident.id]);
      await this.insertUpdate(client,incident.id,'CLOSURE',input.note,'RESOLVED','CLOSED',userId);
      await this.auditAndEvent(client,{action:'SERVICE_INCIDENT_CLOSED',eventType:'experience.incident_closed',entityType:'SERVICE_INCIDENT',entityId:incident.id,businessCode:code,payload:{incidentCode:code}});
      return this.getIncidentWithClient(client,code);
    });
  }

  async proposeCompensation(code:string,input:{compensationTypeCode:string;amount?:number;description:string;proposedByUserCode?:string}){
    return this.db.transaction(async(client)=>{
      const incident=await this.lockIncident(client,code); const userId=await this.resolveUser(client,input.proposedByUserCode);
      if(incident.status_code==='CLOSED')throw new ConflictException('INCIDENT_CLOSED');
      const compensationId=randomUUID(); const compensationCode=await this.nextCode(client,'COMPENSATION');
      await client.query(`INSERT INTO experience.compensations(id,compensation_code,incident_id,compensation_type_code,amount,description,proposed_by)
        VALUES($1,$2,$3,$4,$5,$6,$7)`,[compensationId,compensationCode,incident.id,input.compensationTypeCode,input.amount ?? null,input.description,userId]);
      await this.insertUpdate(client,incident.id,'COMPENSATION_PROPOSED',`Compensación ${compensationCode}: ${input.description}`,incident.status_code,incident.status_code,userId);
      await this.auditAndEvent(client,{action:'COMPENSATION_PROPOSED',eventType:'experience.compensation_proposed',entityType:'COMPENSATION',entityId:compensationId,businessCode:compensationCode,payload:{compensationCode,incidentCode:code,amount:input.amount ?? null}});
      return {success:true,data:{compensationCode,status:'PROPOSED'},meta:{timestamp:new Date().toISOString()}};
    });
  }

  async approveCompensation(code:string,input:{approvedByUserCode:string}){
    return this.db.transaction(async(client)=>{
      const userId=await this.resolveUser(client,input.approvedByUserCode);
      const result=await client.query<any>(`SELECT c.id,c.status_code,c.incident_id,i.incident_code FROM experience.compensations c JOIN experience.incidents i ON i.id=c.incident_id WHERE c.compensation_code=$1 FOR UPDATE OF c`,[code]);
      const compensation=result.rows[0]; if(!compensation)throw new NotFoundException('COMPENSATION_NOT_FOUND');
      if(compensation.status_code!=='PROPOSED')throw new ConflictException('COMPENSATION_NOT_PROPOSED');
      await client.query(`UPDATE experience.compensations SET status_code='APPROVED',approved_by=$2,approved_at=NOW() WHERE id=$1`,[compensation.id,userId]);
      await this.insertUpdate(client,compensation.incident_id,'COMPENSATION_APPROVED',`Compensación ${code} aprobada`,null,null,userId);
      await this.auditAndEvent(client,{action:'COMPENSATION_APPROVED',eventType:'experience.compensation_approved',entityType:'COMPENSATION',entityId:compensation.id,businessCode:code,payload:{compensationCode:code,incidentCode:compensation.incident_code}});
      return {success:true,data:{compensationCode:code,status:'APPROVED'},meta:{timestamp:new Date().toISOString()}};
    });
  }

  private async lockIncident(client:PoolClient,code:string){
    const result=await client.query<any>(`SELECT id,status_code FROM experience.incidents WHERE incident_code=$1 FOR UPDATE`,[code]);
    const row=result.rows[0];if(!row)throw new NotFoundException('INCIDENT_NOT_FOUND');return row;
  }

  private async insertUpdate(client:PoolClient,incidentId:string,type:string,note:string,before:string|null,after:string|null,userId:string|null){
    const updateCode=await this.nextCode(client,'INCIDENT_UPDATE');
    await client.query(`INSERT INTO experience.incident_updates(id,update_code,incident_id,update_type_code,note,status_before,status_after,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[randomUUID(),updateCode,incidentId,type,note,before,after,userId]);
  }

  private async getIncidentWithClient(client:PoolClient,code:string){
    const header=await client.query<any>(
      `SELECT i.id,i.incident_code,i.category_code,i.severity_code,i.source_code,i.description,i.status_code,i.due_at,i.opened_at,
              i.acknowledged_at,i.resolved_at,i.closed_at,i.resolution_summary,i.root_cause_code,h.haid,h.household_name,o.order_code,
              c.cpp_code,u.user_code assigned_user_code
       FROM experience.incidents i JOIN household.households h ON h.id=i.household_id
       LEFT JOIN commerce.orders o ON o.id=i.order_id LEFT JOIN operations.cpp c ON c.id=i.cpp_id
       LEFT JOIN core.internal_users u ON u.id=i.assigned_user_id WHERE i.incident_code=$1`,[code]);
    const i=header.rows[0];if(!i)throw new NotFoundException('INCIDENT_NOT_FOUND');
    const updates=await client.query<any>(`SELECT update_code,update_type_code,note,status_before,status_after,created_at FROM experience.incident_updates WHERE incident_id=$1 ORDER BY created_at`,[i.id]);
    const compensations=await client.query<any>(`SELECT compensation_code,compensation_type_code,amount,currency_code,description,status_code,proposed_at,approved_at,applied_at FROM experience.compensations WHERE incident_id=$1 ORDER BY proposed_at`,[i.id]);
    return {success:true,data:{incidentCode:i.incident_code,categoryCode:i.category_code,severity:i.severity_code,source:i.source_code,description:i.description,
      status:i.status_code,dueAt:i.due_at,openedAt:i.opened_at,acknowledgedAt:i.acknowledged_at,resolvedAt:i.resolved_at,closedAt:i.closed_at,
      resolutionSummary:i.resolution_summary,rootCauseCode:i.root_cause_code,haid:i.haid,householdName:i.household_name,orderCode:i.order_code,
      cppCode:i.cpp_code,assignedUserCode:i.assigned_user_code,updates:updates.rows.map((u:any)=>({updateCode:u.update_code,type:u.update_type_code,note:u.note,
        statusBefore:u.status_before,statusAfter:u.status_after,createdAt:u.created_at})),compensations:compensations.rows.map((c:any)=>({compensationCode:c.compensation_code,
        type:c.compensation_type_code,amount:c.amount,currencyCode:c.currency_code,description:c.description,status:c.status_code,proposedAt:c.proposed_at,
        approvedAt:c.approved_at,appliedAt:c.applied_at}))},meta:{timestamp:new Date().toISOString()}};
  }

  private async auditAndEvent(client:PoolClient,input:{action:string;eventType:string;entityType:string;entityId:string;businessCode:string;payload:Record<string,unknown>}){
    await client.query(`INSERT INTO audit.audit_events(id,audit_code,actor_type,action_code,module_code,entity_type,entity_id,entity_business_code,new_value,result_code,occurred_at)
      VALUES($1,$2,'SYSTEM',$3,'EXPERIENCE',$4,$5,$6,$7,'SUCCESS',NOW())`,[randomUUID(),`AUD-${randomUUID()}`,input.action,input.entityType,input.entityId,input.businessCode,JSON.stringify(input.payload)]);
    await client.query(`INSERT INTO core.domain_events(id,event_code,event_type,event_version,aggregate_type,aggregate_id,aggregate_business_code,payload,status_code,occurred_at)
      VALUES($1,$2,$3,1,$4,$5,$6,$7,'PENDING',NOW())`,[randomUUID(),`EVT-${randomUUID()}`,input.eventType,input.entityType,input.entityId,input.businessCode,JSON.stringify(input.payload)]);
  }
}
