import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HypothesisList } from '../components/HypothesisList';
import type { Hypothesis } from '../types';

const mockHypotheses: Hypothesis[] = [
  {
    id: 'h1',
    title: 'Tool wear causing increased cutting force',
    confidence: 85,
    evidenceFor: [
      'Power deviation started gradually at 10:24',
      'Vibration increased from 2.5 to 8.2 mm/s',
      'Cycle time increased by 15%',
    ],
    evidenceAgainst: [
      'No tool change event logged in last 24h',
    ],
  },
  {
    id: 'h2',
    title: 'Spindle bearing degradation',
    confidence: 65,
    evidenceFor: [
      'Vibration pattern consistent with bearing fault',
      'Temperature rising on spindle housing',
    ],
    evidenceAgainst: [
      'Bearing replaced 30 days ago',
    ],
  },
];

describe('HypothesisList', () => {
  it('renders all hypotheses', () => {
    render(<HypothesisList hypotheses={mockHypotheses} />);
    expect(screen.getByText('Tool wear causing increased cutting force')).toBeInTheDocument();
    expect(screen.getByText('Spindle bearing degradation')).toBeInTheDocument();
  });

  it('displays confidence percentages', () => {
    render(<HypothesisList hypotheses={mockHypotheses} />);
    expect(screen.getByText('85% likely')).toBeInTheDocument();
    expect(screen.getByText('65% likely')).toBeInTheDocument();
  });

  it('displays evidence for items', () => {
    render(<HypothesisList hypotheses={mockHypotheses} />);
    expect(screen.getByText('Power deviation started gradually at 10:24')).toBeInTheDocument();
    expect(screen.getByText('Vibration increased from 2.5 to 8.2 mm/s')).toBeInTheDocument();
  });

  it('displays evidence against items', () => {
    render(<HypothesisList hypotheses={mockHypotheses} />);
    expect(screen.getByText('No tool change event logged in last 24h')).toBeInTheDocument();
    expect(screen.getByText('Bearing replaced 30 days ago')).toBeInTheDocument();
  });

  it('shows evidence labels', () => {
    render(<HypothesisList hypotheses={mockHypotheses} />);
    expect(screen.getAllByText('Why this fits').length).toBe(2);
    expect(screen.getAllByText('What argues against it').length).toBe(2);
  });

  it('renders empty state when no hypotheses', () => {
    render(<HypothesisList hypotheses={[]} />);
    expect(screen.getByText('No hypotheses yet. Run the AI investigation first.')).toBeInTheDocument();
  });
});
