import { IsString, MinLength } from 'class-validator';

export class CreateJiraStoryImportDto {
  @IsString()
  integrationConfigId!: string;

  // Accepts either a full story link (https://your-company.atlassian.net/browse/PN-20387)
  // or a bare issue key (PN-20387) — parsed in the service.
  @IsString()
  @MinLength(1)
  storyUrlOrKey!: string;
}
