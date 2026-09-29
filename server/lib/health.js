// Objective project health and progress, computed from task data only.
import { db } from '../db.js';
import { today } from './http.js';

export function isBlocked(task, allTasks) {
  return (task.blockedBy || []).some(id => {
    const dep = allTasks.find(t => t.id === id);
    return dep && !dep.deletedAt && dep.status !== 'Done';
  });
}

export function projectStats(project, allTasks = db.get('tasks')) {
  const tasks = allTasks.filter(t => t.projectId === project.id && !t.deletedAt && !t.archivedAt);
  const now = today();
  const total = tasks.length;
  const completed = tasks.filter(t => t.status === 'Done').length;
  const open = tasks.filter(t => t.status !== 'Done');
  const overdue = open.filter(t => t.dueDate && t.dueDate < now).length;
  const blocked = open.filter(t => isBlocked(t, allTasks)).length;
  const progress = total ? Math.round((completed / total) * 100) : 0;
  const daysLeft = project.dueDate ? Math.ceil((Date.parse(project.dueDate) - Date.parse(now)) / 86400000) : null;

  // Scoring rules (documented in the Help Center):
  //  Critical — project past its deadline with open work, 3+ overdue tasks,
  //             or overdue >= 25% of open tasks.
  //  At Risk  — any overdue or blocked task, or deadline within 7 days while
  //             less than 70% complete.
  //  Healthy  — otherwise.
  const reasons = [];
  let health = 'Healthy';
  if ((daysLeft !== null && daysLeft < 0 && open.length > 0) || overdue >= 3 || (open.length > 0 && overdue / open.length >= 0.25 && overdue > 0)) {
    health = 'Critical';
  } else if (overdue > 0 || blocked > 0 || (daysLeft !== null && daysLeft <= 7 && progress < 70 && open.length > 0)) {
    health = 'At Risk';
  }
  if (overdue) reasons.push(`${overdue} tarefa(s) atrasada(s)`);
  if (blocked) reasons.push(`${blocked} tarefa(s) bloqueada(s)`);
  if (daysLeft !== null && daysLeft < 0 && open.length) reasons.push('Prazo do projeto vencido');
  else if (daysLeft !== null && daysLeft <= 7 && open.length) reasons.push(`Prazo em ${daysLeft} dia(s) com ${progress}% concluído`);

  return { totalTasks: total, completedTasks: completed, openTasks: open.length, overdueTasks: overdue, blockedTasks: blocked, progress, daysLeft, health, healthReasons: reasons };
}

export function withStats(project, user, allTasks) {
  return {
    ...project,
    ...projectStats(project, allTasks),
    isFavorite: Boolean(user?.favoriteProjects?.includes(project.id)),
    milestones: db.filter('milestones', m => m.projectId === project.id)
  };
}
