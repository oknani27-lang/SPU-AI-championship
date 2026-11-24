import { describe,expect,it,vi } from "vitest";
import {SupabaseStore} from "@/lib/store/supabase-store";
import type {CalendarEventRecord} from "@/types/careplan";
const event:CalendarEventRecord={id:"event",user_id:"owner",title:"Doctor",event_type:"doctor",description:"",start_date:"2026-11-02",end_date:"2026-11-02",start_time:"09:00",end_time:"10:00",is_all_day:false,recurrence:"weekly",until_date:null,excluded_dates:[],reminder_minutes:15,created_at:"2026-11-01T00:00:00Z",updated_at:"2026-11-01T00:00:00Z"};
function fixture(){
 const seen:unknown[][]=[];
 const chain={select:vi.fn().mockReturnThis(),eq:vi.fn().mockImplementation((...args)=>{seen.push(args);return chain;}),maybeSingle:vi.fn().mockResolvedValue({data:event,error:null})};
 const rpc=vi.fn().mockResolvedValue({data:{event,split_event:{...event,id:"split"}},error:null});
 const store=Object.create(SupabaseStore.prototype) as SupabaseStore;
 Object.assign(store,{adminClient:{from:()=>chain,rpc},requireBootstrap:vi.fn().mockResolvedValue({})});return{store,rpc,chain,seen};
}
describe("Live calendar atomic writes",()=>{
 it("uses one owner/version-guarded transaction for recurring split",async()=>{
  const f=fixture();const result=await f.store.updateCalendarEvent("owner","event",{edit_scope:"single",occurrence_date:"2026-11-09",start_time:"11:00",end_time:"12:00"});
  expect(f.rpc).toHaveBeenCalledTimes(1);expect(f.rpc).toHaveBeenCalledWith("careplan_change_calendar_event",expect.objectContaining({p_user_id:"owner",p_event_id:"event",p_expected_updated_at:event.updated_at,p_fields:expect.objectContaining({event_type:"doctor",recurrence:"never"})}));expect(f.seen).toContainEqual(["user_id","owner"]);expect(result.split_event?.id).toBe("split");
 });
 it("does not write arbitrary non-occurrence changes",async()=>{
  const f=fixture();await expect(f.store.deleteCalendarEvent("owner","event",{delete_scope:"future",occurrence_date:"2026-11-03"})).rejects.toThrow();expect(f.rpc).not.toHaveBeenCalled();
 });
 it("surfaces RPC conflict instead of reporting success",async()=>{
  const f=fixture();f.rpc.mockResolvedValueOnce({data:null,error:{message:"Event changed; reload before saving"}});await expect(f.store.updateCalendarEvent("owner","event",{title:"Revised"})).rejects.toThrow("Event changed");
 });
});
