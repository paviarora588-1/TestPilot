import { PrismaService } from '../prisma/prisma.service';
import type { AutomationStatus } from '../../generated/prisma/enums';

const STATUS_ORDER: AutomationStatus[] = ['NOT_STARTED', 'MAPPED', 'SCRIPT_GENERATED', 'AUTOMATED'];

// TestCase.automationStatus is a forward-moving pipeline marker (Object
// Library mapped → script generated → a real execution passed) — this only
// ever advances it, never downgrades, so re-generating a flow/script for a
// test case that's already been successfully automated doesn't regress its
// Dashboard/Reports coverage numbers.
export async function advanceAutomationStatus(
  prisma: PrismaService,
  testCaseId: string | null | undefined,
  next: AutomationStatus,
): Promise<void> {
  if (!testCaseId) return;
  const testCase = await prisma.testCase.findUnique({ where: { id: testCaseId }, select: { automationStatus: true } });
  if (!testCase) return;
  if (STATUS_ORDER.indexOf(next) <= STATUS_ORDER.indexOf(testCase.automationStatus)) return;
  await prisma.testCase.update({ where: { id: testCaseId }, data: { automationStatus: next } });
}
