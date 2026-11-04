import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CrmService } from './crm.service';
import { AuthUser, CurrentUser, Requires } from '../../auth/decorators';
import { normalizePhone } from '../../common/zod';

@Controller()
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  @Requires('customers.read') @Get('customers')
  list(@Query('q') q?: string) { return this.crm.listCustomers(q); }

  @Requires('customers.read') @Get('customers/duplicates')
  duplicates(@Query('phone') phone?: string, @Query('email') email?: string, @Query('name') name?: string) {
    return this.crm.findPossibleDuplicates({ phone: phone ? normalizePhone(phone) : undefined, email: email?.toLowerCase(), name });
  }

  @Requires('customers.write') @Post('customers')
  create(@Body() body: unknown, @CurrentUser() u: AuthUser) { return this.crm.createCustomer(body, u); }

  @Requires('customers.read') @Get('customers/:id')
  get(@Param('id', ParseUUIDPipe) id: string) { return this.crm.getCustomer(id); }

  @Requires('customers.write') @Patch('customers/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() u: AuthUser) { return this.crm.updateCustomer(id, body, u); }

  @Requires('payments.clear') @Patch('customers/:id/credit')
  credit(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() u: AuthUser) { return this.crm.updateCredit(id, body, u); }

  @Requires('customers.write') @Post('customers/:id/vehicles')
  addVehicle(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() u: AuthUser) { return this.crm.addVehicle(id, body, u); }

  @Requires('customers.read') @Get('vehicles')
  searchVehicles(@Query('q') q = '') { return q.trim().length >= 2 ? this.crm.searchVehicles(q) : []; }

  @Requires('customers.read') @Get('vehicles/:id')
  vehicle(@Param('id', ParseUUIDPipe) id: string) { return this.crm.getVehicle(id); }
}
