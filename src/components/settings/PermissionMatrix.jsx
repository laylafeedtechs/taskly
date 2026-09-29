import React from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { useAsync } from '../../lib/hooks';
import { ROLE_LABEL } from '../../lib/format';
import { AsyncBoundary, Icon } from '../ui';
import { Section, TableWrap, Th, Td } from './common';

const ROLE_COLUMNS = [['Owner', 'owner'], ['Manager', 'manager'], ['Member', 'member'], ['Viewer', 'viewer']];

export function PermissionMatrixTable({ matrix, myRole }) {
  return (
    <TableWrap minWidth={560}>
      <thead>
        <tr>
          <Th>Permissão</Th>
          {ROLE_COLUMNS.map(([role]) => (
            <Th key={role} className={`text-center ${role === myRole ? 'text-text-primary bg-blue-500/10' : ''}`}>
              {ROLE_LABEL[role]}{role === myRole && <span className="sr-only"> (seu papel)</span>}
            </Th>
          ))}
        </tr>
      </thead>
      <tbody>
        {matrix.map(row => (
          <tr key={row.key}>
            <th scope="row" className="text-left font-normal px-3 py-2.5 border-b border-border-subtle text-text-primary">{row.module}</th>
            {ROLE_COLUMNS.map(([role, key]) => (
              <Td key={role} className={`text-center ${role === myRole ? 'bg-blue-500/5' : ''}`}>
                {row[key]
                  ? <Icon name="check_circle" size={16} filled className="text-emerald-400" label="Permitido" />
                  : <Icon name="remove" size={16} className="text-text-muted" label="Não permitido" />}
              </Td>
            ))}
          </tr>
        ))}
      </tbody>
    </TableWrap>
  );
}

export function PermissionMatrixSection() {
  const { currentWorkspaceId } = useApp();
  const { data, loading, error, reload } = useAsync(() => api.team.permissionsMatrix(currentWorkspaceId), [currentWorkspaceId]);
  return (
    <Section title="Matriz de permissões" description="O que cada papel pode fazer neste workspace. Sua coluna está destacada.">
      <AsyncBoundary loading={loading} error={error} onRetry={reload} empty={!data?.permissionsMatrix?.length}>
        {data && <PermissionMatrixTable matrix={data.permissionsMatrix} myRole={data.myRole} />}
      </AsyncBoundary>
    </Section>
  );
}
