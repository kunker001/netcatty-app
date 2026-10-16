import type { UploadController } from "../../../lib/uploadService";

// External folder uploads start in a React panel, but their work is not owned
// by that panel. Keep the controller registry at module scope so closing the
// terminal only removes the view; the global transfer runtime can still cancel
// the upload, and the upload's own finally block releases these entries.
const controllersByTaskId = new Map<string, UploadController>();
const taskIdsByController = new Map<UploadController, Set<string>>();

export function registerExternalUploadController(
  taskId: string,
  controller: UploadController,
): void {
  if (!taskId) return;
  const previous = controllersByTaskId.get(taskId);
  if (previous && previous !== controller) {
    const previousIds = taskIdsByController.get(previous);
    previousIds?.delete(taskId);
    if (previousIds?.size === 0) taskIdsByController.delete(previous);
  }
  controllersByTaskId.set(taskId, controller);
  const taskIds = taskIdsByController.get(controller) ?? new Set<string>();
  taskIds.add(taskId);
  taskIdsByController.set(controller, taskIds);
}

export function unregisterExternalUploadController(controller: UploadController): void {
  const taskIds = taskIdsByController.get(controller);
  if (!taskIds) return;
  for (const taskId of taskIds) {
    if (controllersByTaskId.get(taskId) === controller) {
      controllersByTaskId.delete(taskId);
    }
  }
  taskIdsByController.delete(controller);
}

export function getExternalUploadController(taskId: string): UploadController | undefined {
  return controllersByTaskId.get(taskId);
}

export async function cancelExternalUploadRuntime(taskId?: string): Promise<boolean> {
  const controllers = taskId
    ? [controllersByTaskId.get(taskId)].filter((value): value is UploadController => !!value)
    : [...taskIdsByController.keys()];
  if (controllers.length === 0) return false;
  await Promise.all([...new Set(controllers)].map((controller) => controller.cancel()));
  return true;
}

export function resetExternalUploadRuntimeForTests(): void {
  controllersByTaskId.clear();
  taskIdsByController.clear();
}
