import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { DiagnosticsService } from './diagnostics.service';
import { QuotationsService } from './quotations.service';
import { RepairsService } from './repairs.service';
import { AuthUser, CurrentUser, Requires } from '../../auth/decorators';
import { z } from '../../common/zod';

const Reason = z.object({ reason: z.string().trim().min(5).max(1000) });

@Controller()
export class WorkshopController {
  constructor(
    private readonly jobs: JobsService,
    private readonly diag: DiagnosticsService,
    private readonly quotes: QuotationsService,
    private readonly repairs: RepairsService,
  ) {}

  // Reception & jobs
  @Requires('reception.create') @Post('reception')
  receive(@Body() b: unknown, @CurrentUser() u: AuthUser) { return this.jobs.receive(b, u); }

  @Requires('jobs.read') @Get('jobs')
  list(@CurrentUser() u: AuthUser, @Query('status') status?: string, @Query('q') q?: string) { return this.jobs.list({ status, q, branchId: u.branchId }); }

  @Requires('jobs.read') @Get('jobs/:id')
  get(@Param('id', ParseUUIDPipe) id: string) { return this.jobs.get(id); }

  @Requires('jobs.assign') @Post('jobs/:id/assign')
  assign(@Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @CurrentUser() u: AuthUser) { return this.jobs.assign(id, b, u); }

  @Requires('jobs.advance', 'jobs.assign') @Post('jobs/:id/start-diagnosis')
  startDiagnosis(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { return this.jobs.startDiagnosis(id, u); }

  @Requires('jobs.hold') @Post('jobs/:id/hold')
  hold(@Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @CurrentUser() u: AuthUser) { return this.jobs.hold(id, Reason.parse(b).reason, u); }

  @Requires('jobs.hold') @Post('jobs/:id/resume')
  resume(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { return this.jobs.resume(id, u); }

  @Requires('jobs.hold') @Post('jobs/:id/cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @CurrentUser() u: AuthUser) { return this.jobs.cancel(id, Reason.parse(b).reason, u); }

  @Requires('jobs.advance') @Post('jobs/:id/deliver')
  deliver(@Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @CurrentUser() u: AuthUser) { return this.jobs.deliver(id, b, u); }

  @Requires('jobs.advance') @Post('jobs/:id/follow-up')
  followUp(@Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @CurrentUser() u: AuthUser) { return this.jobs.followUp(id, b, u); }

  // Exceptions
  @Requires('exceptions.request') @Post('jobs/:id/exceptions')
  requestException(@Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @CurrentUser() u: AuthUser) { return this.jobs.requestException(id, b, u); }

  @Requires('exceptions.authorise') @Get('exceptions/pending')
  pendingExceptions(@CurrentUser() u: AuthUser) { return this.jobs.listPendingExceptions(u.branchId); }

  @Requires('exceptions.authorise') @Post('exceptions/:id/authorise')
  authorise(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { return this.jobs.decideException(id, 'AUTHORISED', u); }

  @Requires('exceptions.authorise') @Post('exceptions/:id/reject')
  rejectException(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { return this.jobs.decideException(id, 'REJECTED', u); }

  // Diagnostics
  @Requires('diagnostics.write') @Post('jobs/:id/diagnostic-report')
  openReport(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { return this.diag.openReport(id, u); }

  @Requires('diagnostics.write') @Put('diagnostic-reports/:id')
  updateReport(@Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @CurrentUser() u: AuthUser) { return this.diag.update(id, b, u); }

  @Requires('diagnostics.write') @Post('diagnostic-reports/:id/findings')
  addFinding(@Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @CurrentUser() u: AuthUser) { return this.diag.addFinding(id, b, u); }

  @Requires('diagnostics.write') @Post('diagnostic-reports/:id/submit')
  submitReport(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { return this.diag.submit(id, u); }

  // Quotations
  @Requires('quotations.write') @Post('jobs/:id/quotations')
  createQuote(@Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @CurrentUser() u: AuthUser) { return this.quotes.create(id, b, u); }

  @Requires('quotations.read') @Get('quotations/:id')
  getQuote(@Param('id', ParseUUIDPipe) id: string) { return this.quotes.get(id); }

  @Requires('quotations.write') @Put('quotations/:id')
  reviseQuote(@Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @CurrentUser() u: AuthUser) { return this.quotes.revise(id, b, u); }

  @Requires('quotations.write') @Post('quotations/:id/send')
  sendQuote(@Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @CurrentUser() u: AuthUser) { return this.quotes.send(id, b, u); }

  @Requires('quotations.record_approval') @Post('quotations/:id/decision')
  decide(@Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @CurrentUser() u: AuthUser) { return this.quotes.recordDecision(id, b, u); }

  // Repairs & QC
  @Requires('jobs.advance', 'jobs.assign') @Post('jobs/:id/start-repair')
  startRepair(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { return this.repairs.startRepair(id, u); }

  @Requires('jobs.assign') @Post('tasks/:id/assign')
  assignTask(@Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @CurrentUser() u: AuthUser) { return this.repairs.assignTask(id, b, u); }

  @Requires('repairs.write') @Post('tasks/:id/start')
  startTask(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { return this.repairs.startTask(id, u); }

  @Requires('repairs.write') @Post('tasks/:id/complete')
  completeTask(@Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @CurrentUser() u: AuthUser) { return this.repairs.completeTask(id, b, u); }

  @Requires('repairs.write', 'jobs.advance') @Post('jobs/:id/submit-qc')
  submitForQc(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { return this.repairs.submitForQc(id, u); }

  @Requires('jobs.advance', 'jobs.assign') @Post('jobs/:id/skip-qc')
  skipQc(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { return this.repairs.skipQc(id, u); }

  @Requires('jobs.read') @Get('jobs/:id/qc-template')
  qcTemplate(@Param('id', ParseUUIDPipe) id: string) { return this.repairs.qcTemplateForJob(id); }

  @Requires('qc.inspect') @Post('jobs/:id/qc')
  qc(@Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @CurrentUser() u: AuthUser) { return this.repairs.submitQc(id, b, u); }
}
