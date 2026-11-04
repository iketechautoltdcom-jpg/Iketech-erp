import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { BillingService } from './billing.service';
import { AuthUser, CurrentUser, Requires } from '../../auth/decorators';
import { z } from '../../common/zod';

@Controller()
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Requires('invoices.create') @Post('jobs/:id/invoice')
  issue(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { return this.billing.issueForJob(id, u); }

  @Requires('jobs.advance', 'payments.clear') @Post('jobs/:id/release')
  release(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { return this.billing.release(id, u); }

  @Requires('invoices.read') @Get('invoices')
  list(@CurrentUser() u: AuthUser, @Query('status') status?: string, @Query('customerId') customerId?: string) { return this.billing.listInvoices({ branchId: u.branchId, status, customerId }); }

  @Requires('invoices.read') @Get('invoices/:id')
  get(@Param('id', ParseUUIDPipe) id: string) { return this.billing.getInvoice(id); }

  @Requires('payments.record') @Post('payments')
  record(@Body() b: unknown, @CurrentUser() u: AuthUser) { return this.billing.recordPayment(b, u); }

  @Requires('payments.read') @Get('payments')
  payments(@CurrentUser() u: AuthUser, @Query('status') status?: string) { return this.billing.listPayments({ branchId: u.branchId, status }); }

  @Requires('payments.clear') @Post('payments/:id/clear')
  clear(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { return this.billing.clearPayment(id, u); }

  @Requires('payments.reverse') @Post('payments/:id/fail')
  fail(@Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @CurrentUser() u: AuthUser) {
    return this.billing.failPayment(id, z.object({ reason: z.string().trim().min(5) }).parse(b).reason, u);
  }

  @Requires('payments.read') @Get('payments/:id/receipt')
  receipt(@Param('id', ParseUUIDPipe) id: string) { return this.billing.getReceipt(id); }
}
