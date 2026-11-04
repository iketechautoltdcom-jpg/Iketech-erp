import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { createHash, randomUUID } from 'crypto';
import { mkdirSync, writeFileSync, createReadStream, existsSync } from 'fs';
import { join, resolve } from 'path';
import { DbService } from '../../db/db';
import { AuditService } from '../../audit/audit.service';
import { AuthUser, CurrentUser, Requires } from '../../auth/decorators';
import { DomainError, notFound } from '../../common/errors';
import { z, uuid } from '../../common/zod';

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'video/mp4', 'video/quicktime', 'application/pdf']);
const OWNER_TABLES: Record<string, string> = {
  job: 'jobs', diagnostic_report: 'diagnostic_reports', quality_control_inspection: 'quality_control_inspections', customer_approval: 'customer_approvals',
};

/**
 * Private file storage. Files live outside any public web root and are only streamed to signed-in staff with
 * job access. In production, set STORAGE_DIR to a mounted volume or replace this adapter with private object
 * storage (S3-compatible) using short-lived signed URLs — the attachments table stays the same.
 */
export const storageDir = () => resolve(process.env.STORAGE_DIR || join(process.cwd(), 'storage'));

@Controller('attachments')
export class FilesController {
  constructor(private readonly dbs: DbService, private readonly audit: AuditService) {}

  @Requires('jobs.read') @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  async upload(@UploadedFile() file: Express.Multer.File, @Body() b: unknown, @CurrentUser() u: AuthUser) {
    const input = z.object({
      ownerType: z.enum(['job', 'diagnostic_report', 'quality_control_inspection', 'customer_approval']),
      ownerId: uuid, caption: z.string().max(200).optional(),
      visibility: z.enum(['INTERNAL', 'CUSTOMER']).default('INTERNAL'),
    }).parse(b);
    if (!file) throw new DomainError('NO_FILE', 'Attach a file', 400);
    if (!ALLOWED.has(file.mimetype)) throw new DomainError('FILE_TYPE', 'Only photos, videos and PDFs can be attached', 415);
    const owner = await this.dbs.db.selectFrom(OWNER_TABLES[input.ownerType] as any).select('id').where('id', '=', input.ownerId).executeTakeFirst();
    if (!owner) throw notFound('Record to attach to');
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const key = `${new Date().toISOString().slice(0, 7)}/${randomUUID()}`;
    mkdirSync(join(storageDir(), key.split('/')[0]), { recursive: true });
    writeFileSync(join(storageDir(), key), file.buffer, { mode: 0o600 });
    return this.dbs.tx(async (trx) => {
      const row = await trx.insertInto('attachments').values({
        owner_type: input.ownerType, owner_id: input.ownerId, storage_key: key, file_name: file.originalname.slice(0, 200), mime: file.mimetype,
        size: file.size, sha256, visibility: input.visibility, caption: input.caption ?? null, branch_id: u.branchId, created_by: u.id,
      }).returningAll().executeTakeFirstOrThrow();
      await this.audit.write(trx, { actorId: u.id, action: 'attachment.add', entity: input.ownerType, entityId: input.ownerId, after: { id: row.id, file: row.file_name, sha256 }, ip: u.ip });
      return row;
    });
  }

  @Requires('jobs.read') @Get()
  list(@Query('ownerType') ownerType: string, @Query('ownerId', ParseUUIDPipe) ownerId: string) {
    return this.dbs.db.selectFrom('attachments').select(['id', 'file_name', 'mime', 'size', 'caption', 'visibility', 'created_at'])
      .where('owner_type', '=', ownerType).where('owner_id', '=', ownerId).orderBy('created_at').execute();
  }

  @Requires('jobs.read') @Get(':id')
  async download(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const a = await this.dbs.db.selectFrom('attachments').selectAll().where('id', '=', id).executeTakeFirst();
    const path = a && join(storageDir(), a.storage_key);
    if (!a || !existsSync(path!)) throw notFound('File');
    res.setHeader('Content-Type', a.mime);
    res.setHeader('Content-Disposition', `inline; filename="${a.file_name.replace(/[^\w.\- ]/g, '_')}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    createReadStream(path!).pipe(res);
  }
}
