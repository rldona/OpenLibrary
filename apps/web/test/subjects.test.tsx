import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SubjectsInput } from '../src/components/subjects';
import { renderUi } from './render';

describe('SubjectsInput', () => {
  it('adds a typed genre and one the library already uses', async () => {
    const user = userEvent.setup();
    const changes: string[] = [];
    renderUi(<SubjectsInput value="" onChange={(v) => changes.push(v)} suggestions={['Ensayo', 'Novela']} />);

    const input = screen.getByRole('combobox');
    await user.type(input, 'Ciencia ficción{Enter}');
    expect(changes.at(-1)).toBe('Ciencia ficción');

    await user.click(input);
    await user.click(screen.getByRole('option', { name: 'Ensayo' }));
    expect(changes.at(-1)).toBe('Ensayo');
  });
});
