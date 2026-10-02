'use client';

import { ListChecks } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { TestCase } from '@/lib/types';

// Read-only reference for whoever is building a flow's steps by hand — the
// canvas has no other way to see what the linked test case actually asks
// for once its creation dialog has closed.
export function TestCaseReferencePanel({ testCase }: { testCase: TestCase }) {
  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <ListChecks className="h-4 w-4 text-muted-foreground" />
        Linked Test Case
      </div>
      <div>
        <p className="text-sm font-medium">{testCase.title}</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {testCase.moduleName || testCase.featureName ? (
            <Badge variant="outline">{[testCase.moduleName, testCase.featureName].filter(Boolean).join(' / ')}</Badge>
          ) : null}
          <Badge variant="secondary">{testCase.priority}</Badge>
        </div>
      </div>

      {testCase.preconditions ? (
        <div>
          <p className="text-xs font-medium text-muted-foreground">Preconditions</p>
          <p className="text-sm">{testCase.preconditions}</p>
        </div>
      ) : null}

      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground">Steps</p>
        {(testCase.steps ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No steps recorded on this test case.</p>
        ) : (
          <ol className="list-decimal space-y-1.5 pl-5 text-sm">
            {(testCase.steps ?? []).map((step) => (
              <li key={step.id}>
                {step.instruction}
                {step.expectedResult ? (
                  <span className="block text-xs text-muted-foreground">Expect: {step.expectedResult}</span>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </div>

      {testCase.expectedResult ? (
        <div>
          <p className="text-xs font-medium text-muted-foreground">Expected result</p>
          <p className="text-sm">{testCase.expectedResult}</p>
        </div>
      ) : null}
    </div>
  );
}
