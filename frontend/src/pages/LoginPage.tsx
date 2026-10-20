import {
  Badge,
  Box,
  Circle,
  Code,
  Heading,
  HStack,
  SimpleGrid,
  Stack,
  Text,
} from "@chakra-ui/react";
import type { ReactNode } from "react";
import type { IconType } from "react-icons";
import { FiAward, FiGithub, FiZap } from "react-icons/fi";
import { Navigate } from "react-router-dom";
import { AuthSpinner } from "../components/auth/AuthSpinner";
import { GoogleSignInButton } from "../components/auth/GoogleSignInButton";
import { RoasterMascot } from "../components/mascot";
import {
  AnimatedList,
  CursorGlow,
  GlassCard,
  PageWrapper,
} from "../components/ui";
import { useAuth } from "../hooks/useAuth";
import { DEFAULT_POST_LOGIN_PATH } from "../services/authService";

interface HowItWorksStep {
  icon: IconType;
  title: string;
  description: string;
}

const STEPS: HowItWorksStep[] = [
  {
    icon: FiGithub,
    title: "Paste your repo",
    description:
      "Any public GitHub link works — assignment, side project, anything.",
  },
  {
    icon: FiZap,
    title: "Pick your spice level",
    description:
      "Mild 🌶️, Medium 🌶️🌶️ or Extra Spicy 🌶️🌶️🌶️ — pick the heat level you can handle.",
  },
  {
    icon: FiAward,
    title: "Get roasted + improve",
    description:
      "Roast, a score out of 100, and actionable tips to level up your code.",
  },
];

interface RoastExample {
  repo: string;
  intensity: string;
  badgeScheme: string;
  roast: ReactNode;
  score: number;
  scoreBg: string;
  tip: string;
}

const EXAMPLES: RoastExample[] = [
  {
    repo: "student/todo-app-final-FINAL-v2",
    intensity: "Extra Spicy 🌶️🌶️🌶️",
    badgeScheme: "red",
    roast: (
      <>
        “Bro, 800 lines in <Code>main.py</Code>? That's not a file, that's a
        novel. And that API key in <Code>config.py</Code>… generous of you to
        make it public on GitHub, no? 😭”
      </>
    ),
    score: 42,
    scoreBg: "red.500",
    tip: "split main.py into modules & move secrets to .env",
  },
  {
    repo: "learner/ai-chatbot-starter",
    intensity: "Medium 🌶️🌶️",
    badgeScheme: "orange",
    roast: (
      <>
        “The chatbot logic is solid, but the only thing in your{" "}
        <Code>README.md</Code> is ‘TODO’? How will you explain this in an
        interview? And no tests either — when a bug shows up, even the bot
        will laugh 😅”
      </>
    ),
    score: 71,
    scoreBg: "orange.400",
    tip: "add a README with setup steps and a few pytest cases",
  },
];

export default function LoginPage() {
  const { status } = useAuth();

  if (status === "loading") return <AuthSpinner />;
  if (status === "authenticated")
    return <Navigate to={DEFAULT_POST_LOGIN_PATH} replace />;

  return (
    <PageWrapper maxW="container.xl" py={{ base: 4, md: 4 }}>
      <CursorGlow />
      <SimpleGrid
        columns={{ base: 1, lg: 2 }}
        spacing={{ base: 6, lg: 10 }}
        alignItems="center"
      >
        <Stack spacing={5}>
          <Badge
            alignSelf="flex-start"
            colorScheme="brand"
            variant="solid"
            color="ink.500"
            px={3}
            py={1}
            borderRadius="full"
          >
            AI code review, but make it spicy
          </Badge>
          <Heading as="h1" size="2xl" lineHeight="1.1" fontFamily="display">
            Code Roaster{" "}
            <Box as="span" role="img" aria-label="fire">
              🔥
            </Box>
          </Heading>
          <Text
            fontSize={{ base: "xl", lg: "2xl" }}
            fontWeight="semibold"
            color="accent.fire"
          >
            We roast your code, you improve it!
          </Text>
          <Text color="text.muted" fontSize={{ base: "lg", lg: "xl" }}>
            Drop your GitHub repo and get a brutally honest (but helpful) review
            of your code quality, structure, docs, AI best practices and
            security.
          </Text>
          <Stack spacing={2} align={{ base: "stretch", sm: "flex-start" }}>
            <GoogleSignInButton />
            <Text fontSize="sm" color="text.muted">
              Google login only — no passwords to forget.
            </Text>
          </Stack>
        </Stack>

        <RoasterMascot />
      </SimpleGrid>

      <Box mt={{ base: 8, md: 6 }}>
        <Heading as="h2" size="lg" mb={4} textAlign="center">
          Roast Examples
        </Heading>
        <SimpleGrid columns={{ base: 1, md: 2 }} spacing={6}>
          {EXAMPLES.map((example) => (
            <GlassCard
              key={example.repo}
              static
              aria-label={`Roast example: ${example.repo}`}
              h="full"
            >
              <HStack justify="space-between" mb={4} spacing={3}>
                <HStack spacing={2} minW={0}>
                  <Box as={FiGithub} aria-hidden="true" flexShrink={0} />
                  <Code bg="transparent" fontSize="sm" noOfLines={1}>
                    {example.repo}
                  </Code>
                </HStack>
                <Badge
                  colorScheme={example.badgeScheme}
                  borderRadius="full"
                  px={2}
                  flexShrink={0}
                >
                  {example.intensity}
                </Badge>
              </HStack>
              <Text fontSize="lg" mb={4}>
                {example.roast}
              </Text>
              <HStack spacing={4} align="center">
                <Circle
                  size="56px"
                  bg={example.scoreBg}
                  color="white"
                  fontWeight="bold"
                  fontSize="lg"
                >
                  {example.score}
                </Circle>
                <Stack spacing={0}>
                  <Text fontWeight="semibold">Score: {example.score}/100</Text>
                  <Text fontSize="sm" color="text.muted">
                    Top tip: {example.tip}
                  </Text>
                </Stack>
              </HStack>
            </GlassCard>
          ))}
        </SimpleGrid>
      </Box>

      <Box mt={{ base: 10, md: 12 }}>
        <Heading as="h2" size="lg" mb={6} textAlign="center">
          How it works
        </Heading>
        <AnimatedList
          direction={{ base: "column", md: "row" }}
          spacing={6}
          align="stretch"
        >
          {STEPS.map((step, index) => (
            <GlassCard key={step.title} h="full">
              <HStack spacing={3} mb={3}>
                <Circle
                  size="40px"
                  bg="brand.400"
                  color="ink.500"
                  aria-hidden="true"
                >
                  <Box as={step.icon} />
                </Circle>
                <Heading as="h3" size="sm">
                  {index + 1}. {step.title}
                </Heading>
              </HStack>
              <Text color="text.muted">{step.description}</Text>
            </GlassCard>
          ))}
        </AnimatedList>
      </Box>
    </PageWrapper>
  );
}
