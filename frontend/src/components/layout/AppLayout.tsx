import {
  Avatar,
  Box,
  Button,
  Flex,
  HStack,
  Heading,
  IconButton,
  Menu,
  MenuButton,
  MenuDivider,
  MenuItem,
  MenuList,
  Spacer,
  Text,
  useToast,
} from '@chakra-ui/react';
import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { FiLogOut, FiPlus, FiShield, FiUser } from 'react-icons/fi';
import { Link as RouterLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';

const MotionBox = motion.create(Box);

export interface AppLayoutProps {
  /** Optional explicit content; defaults to the nested route <Outlet />. */
  children?: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const handleLogout = async (): Promise<void> => {
    await logout();
    toast({ title: 'Logged out. Come back soon! 👋', status: 'success', duration: 3000 });
    navigate('/login', { replace: true });
  };

  return (
    <Flex direction="column" minH="100vh">
      <Box
        as="header"
        position="sticky"
        top={0}
        zIndex="sticky"
        borderBottomWidth="1px"
        borderColor="border.subtle"
        bg="bg.header"
        backdropFilter="blur(12px)"
      >
        <Flex maxW="container.xl" mx="auto" px={{ base: 4, md: 6 }} h={16} align="center" gap={3}>
          <MotionBox whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
            <Heading
              as={RouterLink}
              to="/"
              size="md"
              fontFamily="display"
              _hover={{ textDecoration: 'none' }}
            >
              Code Roaster 🔥
            </Heading>
          </MotionBox>
          <Spacer />
          <HStack spacing={3}>
            {user && (
              <MotionBox whileHover={{ scale: 1.04, y: -1 }} whileTap={{ scale: 0.96 }}>
                <Button
                  as={RouterLink}
                  to="/roast/new"
                  size="sm"
                  leftIcon={<FiPlus />}
                  variant="outline"
                  display={{ base: 'none', sm: 'inline-flex' }}
                >
                  New Roast
                </Button>
                <IconButton
                  as={RouterLink}
                  to="/roast/new"
                  aria-label="New Roast"
                  size="sm"
                  icon={<FiPlus />}
                  variant="outline"
                  display={{ base: 'inline-flex', sm: 'none' }}
                />
              </MotionBox>
            )}
            {user ? (
              <Menu placement="bottom-end">
                <MenuButton
                  aria-label={`Account menu for ${user.full_name ?? user.email}`}
                  borderRadius="full"
                  _focusVisible={{ boxShadow: 'outline' }}
                >
                  <Avatar size="sm" name={user.full_name ?? user.email} src={user.avatar_url ?? undefined} />
                </MenuButton>
                <MenuList>
                  <Text px={3} py={2} fontSize="sm" color="text.muted" noOfLines={1}>
                    {user.email}
                  </Text>
                  <MenuDivider />
                  <MenuItem as={RouterLink} to="/profile" icon={<FiUser />}>
                    Profile
                  </MenuItem>
                  {user.is_admin && (
                    <MenuItem as={RouterLink} to="/admin" icon={<FiShield />}>
                      Admin
                    </MenuItem>
                  )}
                  <MenuDivider />
                  <MenuItem icon={<FiLogOut />} onClick={() => void handleLogout()}>
                    Logout
                  </MenuItem>
                </MenuList>
              </Menu>
            ) : null}
          </HStack>
        </Flex>
      </Box>
      <Box as="main" flex="1">
        {children ?? <Outlet />}
      </Box>
    </Flex>
  );
}

export default AppLayout;
