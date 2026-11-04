import 'reflect-metadata';
import { Harness } from './helpers';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { PERMISSION_KEY, PUBLIC_KEY } from '../src/auth/decorators';
import { PERMISSIONS } from '../src/auth/rbac';

/** Fails the build if any route lacks a declared permission, or names a permission that does not exist. */
describe('every route declares its permission', () => {
  let h: Harness;
  beforeAll(async () => { h = await new Harness().start(); });
  afterAll(async () => { await h.stop(); });

  it('has @Requires or @Public on every handler', () => {
    const { NestContainer } = require('@nestjs/core');
    const container = (h.app as any).container;
    const reflector = new Reflector();
    const scanner = new MetadataScanner();
    const problems: string[] = [];
    let routes = 0;
    for (const mod of container.getModules().values()) {
      for (const wrapper of mod.controllers.values()) {
        const proto = Object.getPrototypeOf(wrapper.instance);
        for (const name of scanner.getAllMethodNames(proto)) {
          const handler = proto[name];
          if (!Reflect.getMetadata('path', handler) && Reflect.getMetadata('path', handler) !== '') continue;
          routes++;
          const pub = reflector.getAllAndOverride(PUBLIC_KEY, [handler, wrapper.metatype]);
          const perms: string[] | undefined = reflector.getAllAndOverride(PERMISSION_KEY, [handler, wrapper.metatype]);
          if (!pub && !perms) problems.push(`${wrapper.name}.${name} has no permission`);
          for (const p of perms ?? []) if (!(p in PERMISSIONS)) problems.push(`${wrapper.name}.${name} uses unknown permission ${p}`);
        }
      }
    }
    expect(routes).toBeGreaterThan(50);
    expect(problems).toEqual([]);
  });
});
