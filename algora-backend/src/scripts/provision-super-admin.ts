import { createInterface } from 'node:readline/promises';
import { randomUUID } from 'node:crypto';
import { AppError } from '../middleware/errors.js';
export async function runProvisionCommand() {
  const subject = process.env.PROVISION_SUPER_ADMIN_SUBJECT?.trim();
  if (!subject || !process.stdin.isTTY || !process.stdout.isTTY)
    throw new AppError(
      400,
      'OPERATOR_CONFIRMATION_REQUIRED',
      'Configure the intended Google subject and run in an interactive terminal',
    );
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  let answer: string;
  try {
    answer = await prompt.question(
      'Provision the configured verified Google identity as the sole Super Admin? Type PROVISION SUPER ADMIN: ',
    );
  } finally {
    prompt.close();
  }
  if (answer !== 'PROVISION SUPER ADMIN')
    throw new AppError(
      400,
      'PROVISIONING_CANCELLED',
      'Provisioning was not confirmed',
    );
  // Load database/model infrastructure only after explicit interactive confirmation.
  const { connectDatabase, disconnectDatabase } =
    await import('../config/database.js');
  const { AdministrationService } =
    await import('../administration/service.js');
  const { mongoAdminRepository } =
    await import('../administration/repository.js');
  try {
    await connectDatabase();
    const result = await new AdministrationService(
      mongoAdminRepository,
    ).provision(subject, true, randomUUID());
    process.stdout.write(
      result.provisioned
        ? 'Super Admin provisioned. Existing sessions were invalidated.\n'
        : 'The configured Super Admin is already provisioned.\n',
    );
  } finally {
    await disconnectDatabase();
  }
}
// Only this explicit CLI entry invokes provisioning. No application route imports it.
void runProvisionCommand().catch((error) => {
  process.stderr.write(
    error instanceof AppError
      ? error.message + '\n'
      : 'Provisioning failed safely. Check database availability and required indexes.\n',
  );
  process.exitCode = 1;
});
