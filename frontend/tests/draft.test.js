import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// project.js grabs `window.__TAURI__.core` (and touches sessionStorage/document) at call time,
// and node provides none of these globals, config.test.js works around this by mocking the whole
// module. The draft logic must be tested for real, so we stub the same globals instead.
const invoke = vi.fn();
const appDataDir = vi.fn();
globalThis.window = {
    __TAURI__: { core: { invoke }, path: { appDataDir } },
    addEventListener: vi.fn(), // pagehide handler adds itself at module load
};
globalThis.document = { getElementById: () => null };
globalThis.sessionStorage = { removeItem: vi.fn() };

const DRAFT_PATH = '/data/draft.typ';

/** Reload project.js so module state (currentProject, pendingSave) resets per case. */
async function freshProject() {
    vi.resetModules();
    return await import('../src/js/project.js');
}

describe('project-less draft persistence', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        invoke.mockReset();
        appDataDir.mockImplementation(async () => '/data');
    });
    afterEach(() => { vi.useRealTimers(); });

    it('autosaves typings to {app-data}/draft.typ while no project is open', async () => {
        const project = await freshProject();
        project.scheduleAutosave(() => 'scratch text');
        expect(invoke).not.toHaveBeenCalled(); // debounced
        await vi.advanceTimersByTimeAsync(800);
        expect(invoke).toHaveBeenCalledWith('save_file', { path: DRAFT_PATH, content: 'scratch text' });
    });

    it('flushPendingSave also reaches the draft file (pagehide reload path)', async () => {
        const project = await freshProject();
        project.scheduleAutosave('scratch text');
        await project.flushPendingSave();
        expect(invoke).toHaveBeenCalledWith('save_file', { path: DRAFT_PATH, content: 'scratch text' });
    });

    it('readDraft returns the stored content, or null when the file is missing', async () => {
        const project = await freshProject();
        invoke.mockImplementation((cmd, { path }) => path === DRAFT_PATH ? Promise.resolve('typed before') : Promise.reject('bad path'));
        expect(await project.readDraft()).toBe('typed before');
        invoke.mockRejectedValue('No such file');
        invoke.mockClear();
        expect(await project.readDraft()).toBeNull();
    });

    it('openProject switches the save target to the project and empties the draft', async () => {
        const project = await freshProject();
        project.scheduleAutosave(() => 'scratch text');
        await vi.advanceTimersByTimeAsync(800); // draftless flush completed
        invoke.mockClear();
        invoke.mockImplementation(async (cmd) => {
            if (cmd === 'open_folder_dialog') return '/parent';
            if (cmd === 'open_project') return { name: 'p', path: '/proj', typ_file: 'main.typ', content: 'proj content' };
            return undefined;
        });
        await project.openProject(() => {});
        expect(invoke).toHaveBeenCalledWith('save_file', { path: DRAFT_PATH, content: '' });

        project.scheduleAutosave(() => 'updated in project');
        await vi.advanceTimersByTimeAsync(800);
        expect(invoke).toHaveBeenCalledWith('save_file', { path: '/proj/main.typ', content: 'updated in project' });
        const draftCalls = invoke.mock.calls.filter(([, args]) => args?.path === DRAFT_PATH);
        expect(draftCalls).toHaveLength(1); // only the emptying write, never the project typing
    });
});
