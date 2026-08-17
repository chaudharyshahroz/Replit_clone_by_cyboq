'use server';

import { revalidatePath } from 'next/cache';
import {
  createDocument,
  createImage,
  createPresentation,
  type CreateKind,
  type CreateResult,
} from '@reklu/create';
import { isRekluError, logger } from '@reklu/shared';
import { getAppContext } from '@/lib/auth-context';

export interface CreateFormState {
  readonly error?: string;
  readonly result?: {
    readonly artifactId: string;
    readonly title: string;
    readonly kind: string;
    readonly detail: string;
  };
  /** Echoed back so a failure does not discard what was typed. */
  readonly submitted?: { readonly kind: string; readonly prompt: string };
}

export async function createAction(
  _prev: CreateFormState,
  formData: FormData,
): Promise<CreateFormState> {
  const { user, workspace } = await getAppContext();

  const kind = String(formData.get('kind') ?? 'document') as CreateKind;
  const prompt = String(formData.get('prompt') ?? '').trim();
  const submitted = { kind, prompt };

  if (prompt.length < 8) {
    return { error: 'Describe what you want in a little more detail.', submitted };
  }

  const input = {
    workspaceId: workspace.workspaceId,
    userId: user.id,
    prompt,
  };

  try {
    let result: CreateResult;
    switch (kind) {
      case 'document':
        result = await createDocument(input);
        break;
      case 'presentation':
        result = await createPresentation(input);
        break;
      case 'image':
        result = await createImage(input);
        break;
      default:
        // Video is declared and unimplemented; saying so beats a generic error.
        return {
          error: 'Video generation is not implemented yet.',
          submitted,
        };
    }

    revalidatePath('/artifacts');
    return { result };
  } catch (error) {
    if (isRekluError(error)) return { error: error.userMessage, submitted };
    logger.error('Create failed', { error, kind });
    return { error: 'That could not be created. Try again.', submitted };
  }
}
