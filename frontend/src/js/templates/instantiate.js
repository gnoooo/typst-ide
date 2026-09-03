import { t } from '../../i18n/index.js';
import { showConfirm } from '../modal.js';
import { showToast } from '../toast.js';
import { getCurrentProject } from '../project.js';
import { isAlreadyExists } from '../utils/error-codes.js';

const { invoke } = window.__TAURI__.core;

/**
 * Copies a template folder into the current project (keeping its name),
 * so the user can `#import "<name>/lib.typ": *`.
 * If the folder already exists in the project, asks for confirmation
 * and replaces it (updates the template in the project).
 * @param {string} name Template name.
 */
export async function instantiateTemplate(name) {
  const project = getCurrentProject();
  if (!project) {
    showToast('error', t('template.no_project'));
    return;
  }

  const ok = await showConfirm({
    title: t('template.instantiate_confirm_title'),
    message: t('template.instantiate_confirm_message', { name }),
    confirmLabel: t('template.instantiate'),
  });
  if (!ok) return;

  try {
    await copy(name, project.path, false);
    showToast('success', t('template.instantiated', { name }));
  } catch (err) {
    if (!isAlreadyExists(err)) {
      showToast('error', t('template.instantiate_error', { error: err }));
      return;
    }
    const replace = await showConfirm({
      title: t('template.dest_exists_title'),
      message: t('template.dest_exists_message', { name }),
      confirmLabel: t('template.replace'),
    });
    if (!replace) return;
    try {
      await copy(name, project.path, true);
      showToast('success', t('template.replaced', { name }));
    } catch (err2) {
      showToast('error', t('template.instantiate_error', { error: err2 }));
    }
  }
}

async function copy(name, destDir, overwrite) {
  await invoke('copy_template_to_project', { templateName: name, destDir, overwrite });
}