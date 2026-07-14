import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../../common/database.service';
type Input={alias:string;street:string;exteriorNumber:string;interiorNumber?:string;colonyName:string;postalCode:string;city:string;stateName:string;betweenStreets?:string;references?:string;latitude:number;longitude:number;accessLatitude?:number;accessLongitude?:number;isPrimary?:boolean};
@Injectable()
export class TerritoryService{
 constructor(private readonly db:DatabaseService){}
 async list(haid:string){
  const r=await this.db.query(`SELECT l.location_code,l.alias,l.street,l.exterior_number,l.colony_name,l.postal_code,l.city,l.state_name,l.latitude,l.longitude,l.is_primary,c.is_covered,z.zone_code,o.cpp_code,c.delivery_fee,c.minimum_order
  FROM household.locations l JOIN household.households h ON h.id=l.household_id LEFT JOIN territory.location_coverage c ON c.location_id=l.id AND c.status_code='ACTIVE' LEFT JOIN territory.service_zones z ON z.id=c.zone_id LEFT JOIN operations.cpp o ON o.id=c.cpp_id WHERE h.haid=$1 AND l.is_active=TRUE ORDER BY l.is_primary DESC,l.created_at`,[haid]);
  return {success:true,data:r.rows,meta:{timestamp:new Date().toISOString()}};
 }
 async create(haid:string,input:Input){
  if(!Number.isFinite(input.latitude)||!Number.isFinite(input.longitude)) throw new BadRequestException('LOCATION_COORDINATES_REQUIRED');
  return this.db.transaction(async c=>{
   const h=(await c.query<{id:string}>(`SELECT id FROM household.households WHERE haid=$1 AND is_active=TRUE FOR UPDATE`,[haid])).rows[0];
   if(!h) throw new NotFoundException('HOUSEHOLD_NOT_FOUND');
   const seq=async(code:string)=>{const r=await c.query<{current_value:string;prefix:string;padding:number}>(`UPDATE core.business_sequences SET current_value=current_value+1,updated_at=NOW() WHERE sequence_code=$1 RETURNING current_value,prefix,padding`,[code]);const x=r.rows[0];return `${x.prefix}${String(x.current_value).padStart(x.padding,'0')}`};
   const locationCode=await seq('LOCATION');
   if(input.isPrimary) await c.query(`UPDATE household.locations SET is_primary=FALSE,updated_at=NOW(),version=version+1 WHERE household_id=$1 AND is_active=TRUE`,[h.id]);
   const l=(await c.query<{id:string}>(`INSERT INTO household.locations(location_code,household_id,alias,street,exterior_number,interior_number,colony_name,postal_code,city,state_name,between_streets,references_text,latitude,longitude,access_latitude,access_longitude,is_primary)
   VALUES($1,$2,$3,$4,$5,NULLIF($6,''),$7,$8,$9,$10,NULLIF($11,''),NULLIF($12,''),$13,$14,$15,$16,$17) RETURNING id`,[locationCode,h.id,input.alias.trim(),input.street.trim(),input.exteriorNumber.trim(),input.interiorNumber??'',input.colonyName.trim(),input.postalCode,input.city.trim(),input.stateName.trim(),input.betweenStreets??'',input.references??'',input.latitude,input.longitude,input.accessLatitude??input.latitude,input.accessLongitude??input.longitude,input.isPrimary??true])).rows[0];
   const zone=(await c.query<{zone_id:string;market_id:string;cpp_id:string;zone_code:string;cpp_code:string;delivery_fee:string;minimum_order:string}>(`SELECT z.id zone_id,z.market_id,o.id cpp_id,z.zone_code,o.cpp_code,z.delivery_fee::text,z.minimum_order::text FROM territory.service_zones z JOIN operations.cpp o ON o.id=z.primary_cpp_id WHERE z.status_code='ACTIVE' AND $1 BETWEEN z.min_latitude AND z.max_latitude AND $2 BETWEEN z.min_longitude AND z.max_longitude ORDER BY z.created_at LIMIT 1`,[input.latitude,input.longitude])).rows[0];
   const coverageCode=await seq('COVERAGE');
   await c.query(`INSERT INTO territory.location_coverage(coverage_code,location_id,market_id,zone_id,cpp_id,is_covered,coverage_method,delivery_fee,minimum_order,reason_code) VALUES($1,$2,$3,$4,$5,$6,'BOUNDING_BOX',$7,$8,$9)`,[coverageCode,l.id,zone?.market_id??null,zone?.zone_id??null,zone?.cpp_id??null,Boolean(zone),zone?.delivery_fee??null,zone?.minimum_order??null,zone?null:'OUTSIDE_ACTIVE_ZONE']);
   await c.query(`INSERT INTO audit.audit_events(id,audit_code,actor_type,action_code,entity_type,entity_id,new_value,result_code) VALUES(gen_random_uuid(),$1,'HOUSEHOLD','LOCATION_CREATED','LOCATION',$2,$3,'SUCCESS')`,[`AUD-${randomUUID().slice(0,8)}`,l.id,JSON.stringify({haid,locationCode,covered:Boolean(zone),zoneCode:zone?.zone_code,cppCode:zone?.cpp_code})]);
   return {success:true,data:{locationCode,covered:Boolean(zone),zoneCode:zone?.zone_code??null,cppCode:zone?.cpp_code??null,deliveryFee:zone?Number(zone.delivery_fee):null,minimumOrder:zone?Number(zone.minimum_order):null,reasonCode:zone?null:'OUTSIDE_ACTIVE_ZONE'},meta:{timestamp:new Date().toISOString()}};
  });
 }
 async getCoverage(haid:string,code:string){const r=await this.db.query(`SELECT l.location_code,c.is_covered,c.coverage_method,c.delivery_fee,c.minimum_order,c.reason_code,z.zone_code,z.name zone_name,o.cpp_code,o.name cpp_name FROM household.locations l JOIN household.households h ON h.id=l.household_id JOIN territory.location_coverage c ON c.location_id=l.id AND c.status_code='ACTIVE' LEFT JOIN territory.service_zones z ON z.id=c.zone_id LEFT JOIN operations.cpp o ON o.id=c.cpp_id WHERE h.haid=$1 AND l.location_code=$2 AND l.is_active=TRUE ORDER BY c.evaluated_at DESC LIMIT 1`,[haid,code]);if(!r.rows[0])throw new NotFoundException('LOCATION_NOT_FOUND');return {success:true,data:r.rows[0],meta:{timestamp:new Date().toISOString()}};}
}
