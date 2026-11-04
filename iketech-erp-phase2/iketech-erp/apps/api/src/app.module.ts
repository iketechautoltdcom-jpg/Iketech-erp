import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { DbService } from './db/db';
import { AuditService } from './audit/audit.service';
import { ConfigService } from './config/config.service';
import { AuthService } from './auth/auth.service';
import { AuthGuard } from './auth/auth.guard';
import { AuthController } from './auth/auth.controller';
import { AllExceptionsFilter } from './common/errors';
import { CrmService } from './modules/crm/crm.service';
import { CrmController } from './modules/crm/crm.controller';
import { JobsService } from './modules/workshop/jobs.service';
import { DiagnosticsService } from './modules/workshop/diagnostics.service';
import { QuotationsService } from './modules/workshop/quotations.service';
import { RepairsService } from './modules/workshop/repairs.service';
import { WorkshopController } from './modules/workshop/workshop.controller';
import { LedgerService } from './modules/billing/ledger.service';
import { BillingService } from './modules/billing/billing.service';
import { BillingController } from './modules/billing/billing.controller';
import { ReportsService } from './modules/reports/reports.service';
import { ReportsController } from './modules/reports/reports.controller';
import { AdminController } from './modules/admin/admin.controller';
import { FilesController } from './modules/files/files.controller';
import { HealthController } from './health.controller';

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: Number(process.env.RATE_LIMIT_PER_MIN || 600) }])],
  controllers: [HealthController, AuthController, CrmController, WorkshopController, BillingController, ReportsController, AdminController, FilesController],
  providers: [
    DbService, AuditService, ConfigService, AuthService, CrmService, JobsService, DiagnosticsService, QuotationsService, RepairsService,
    LedgerService, BillingService, ReportsService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
