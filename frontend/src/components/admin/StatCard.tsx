import { Flex, Icon, Skeleton, Stat, StatHelpText, StatLabel, StatNumber } from '@chakra-ui/react';
import type { IconType } from 'react-icons';
import { GlassCard } from '../ui';

interface StatCardProps {
  label: string;
  value: string;
  icon: IconType;
  helpText?: string;
  /** Chakra colour scheme used for the value + icon (e.g. score band). */
  colorScheme?: string;
  isLoading?: boolean;
}

export function StatCard({ label, value, icon, helpText, colorScheme, isLoading = false }: StatCardProps) {
  const accent = colorScheme ? `${colorScheme}.400` : 'accent.fire';
  return (
    <GlassCard p={5}>
      <Stat>
        <Flex justify="space-between" align="center" mb={2}>
          <StatLabel color="text.muted" fontSize="sm">
            {label}
          </StatLabel>
          <Icon as={icon} boxSize={5} color={accent} aria-hidden />
        </Flex>
        <Skeleton isLoaded={!isLoading} borderRadius="md" minH="2.25rem">
          <StatNumber fontSize="3xl" color={colorScheme ? accent : undefined}>
            {value}
          </StatNumber>
        </Skeleton>
        {helpText && <StatHelpText mb={0}>{helpText}</StatHelpText>}
      </Stat>
    </GlassCard>
  );
}

export default StatCard;
