import { Box, Flex, Heading, Icon, Stack, Text } from '@chakra-ui/react';
import type { IconType } from 'react-icons';
import { FiBarChart2, FiFlag, FiList, FiUsers } from 'react-icons/fi';
import { NavLink, Outlet } from 'react-router-dom';

interface AdminNavItem {
  label: string;
  to: string;
  icon: IconType;
  end?: boolean;
}

const NAV_ITEMS: AdminNavItem[] = [
  { label: 'Dashboard', to: '/admin', icon: FiBarChart2, end: true },
  { label: 'Users', to: '/admin/users', icon: FiUsers },
  { label: 'Roasts', to: '/admin/roasts', icon: FiList },
  { label: 'Reports', to: '/admin/reports', icon: FiFlag },
];

export function AdminLayout() {
  return (
    <Flex direction={{ base: 'column', md: 'row' }} minH="calc(100vh - 4rem)">
      <Box
        as="nav"
        aria-label="Admin navigation"
        w={{ base: 'full', md: 60 }}
        flexShrink={0}
        borderRightWidth={{ base: 0, md: '1px' }}
        borderBottomWidth={{ base: '1px', md: 0 }}
        borderColor="border.subtle"
        p={4}
        position={{ base: 'static', md: 'sticky' }}
        top={{ md: 16 }}
        alignSelf={{ md: 'flex-start' }}
        bg={{ base: 'bg.surface', md: 'transparent' }}
      >
        <Heading
          size="xs"
          textTransform="uppercase"
          color="text.muted"
          mb={3}
          px={3}
          display={{ base: 'none', md: 'block' }}
        >
          Admin
        </Heading>
        <Stack direction={{ base: 'row', md: 'column' }} spacing={1} overflowX={{ base: 'auto', md: 'visible' }}>
          {NAV_ITEMS.map((item) => (
            <Box
              key={item.to}
              as={NavLink}
              to={item.to}
              end={item.end}
              display="flex"
              alignItems="center"
              gap={3}
              flexShrink={0}
              px={3}
              py={2}
              borderRadius="lg"
              color="text.muted"
              transition="all 0.15s"
              _hover={{ bg: 'bg.subtle', color: 'chakra-body-text' }}
              sx={{ '&.active': { bg: 'brand.400', color: 'ink.500' } }}
            >
              <Icon as={item.icon} />
              <Text fontWeight="medium">{item.label}</Text>
            </Box>
          ))}
        </Stack>
      </Box>
      <Box flex="1" minW={0}>
        <Outlet />
      </Box>
    </Flex>
  );
}

export default AdminLayout;
