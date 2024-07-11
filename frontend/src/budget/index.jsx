import { useState, useEffect } from 'react'
import { Button, MantineProvider, TabsPanel } from '@mantine/core';
import { SimpleGrid, Skeleton, Container, Stack, useMantineTheme, px } from '@mantine/core';
import {
  Table,
  ScrollArea,
  UnstyledButton,
  Group,
  Text,
  Center,
  TextInput,
  rem,
  keys,
} from '@mantine/core';
import { IconSelector, IconChevronDown, IconChevronUp, IconSearch } from '@tabler/icons-react';
import classes from './TableSort.module.css';
import { Drawer } from '@mantine/core';
import 'react-modern-drawer/dist/index.css'
import "./budget.css"
import '@mantine/core/styles.css';


const fetchBudget = async () => {
  //get from http://localhost:3112/data/budget
  const response = await fetch('http://localhost:3112/data/budget');
  const data = await response.json();
  return data;
}


export default function App() {
  const [budgetData, setBudgetData] = useState(null);
  
  useEffect(() => {
    fetchBudget().then(({budget}) => setBudgetData(budget));
  }, []);
  
  return (
    <MantineProvider>
      {budgetData ? <BudgetViewer budget={budgetData} /> : <div>Loading...</div>}
    </MantineProvider>
  );
}


const getChild = (height) => <Skeleton height={height} radius="md" animate={false} />;
const BASE_HEIGHT = "90vh"; // Changed BASE_HEIGHT to 90 viewport height
const getSubHeight = (children, spacing) =>
  `calc(${BASE_HEIGHT} / ${children} - ${spacing}px * ((${children} - 1) / ${children}))`;

export function BudgetViewer() {
  const theme = useMantineTheme();

  const [drawerContent, setDrawerContent] = useState(null);

return (
    <div className="budget-viewer">
      <header>
        <h1>Budget</h1>
      </header>
      <Drawer  opened={!!drawerContent} onClose={()=>setDrawerContent(null)} title="Authentication"  size="90vw" position='right' offset={8}>
        <Button onClick={() => setDrawerContent(null)}>Close</Button>
        {drawerContent}
        </Drawer>
      <div class="grid-container">
          <BudgetBlock title="Month over Month"  setDrawerContent={setDrawerContent}/>
          <BudgetBlock title="Overview" setDrawerContent={setDrawerContent}/>
          <BudgetBlock title="Mortgage" setDrawerContent={setDrawerContent}/>
          <BudgetBlock title="Monthly Expenses" setDrawerContent={setDrawerContent}/>
          <BudgetBlock title="Yearly Budget" setDrawerContent={setDrawerContent}/>
          <BudgetBlock title="Investments" setDrawerContent={setDrawerContent}/>
        </div>
    </div>
  );
}

function BudgetBlock({ title, key, setDrawerContent }) {

  return (
    <div className="budget-block">
      <h2>{title}</h2>
      <div className="budget-block-content">
        <Button onClick={() => setDrawerContent(<TableSort/>)}>Show</Button>
      </div>
    </div>
  );

}


function Th({ children, reversed, sorted, onSort }) {
  const Icon = sorted ? (reversed ? IconChevronUp : IconChevronDown) : IconSelector;
  return (
    <Table.Th className={classes.th}>
      <UnstyledButton onClick={onSort} className={classes.control}>
        <Group justify="space-between">
          <Text fw={500} fz="sm">
            {children}
          </Text>
          <Center className={classes.icon}>
            <Icon style={{ width: '1rem', height: '1rem' }} stroke={1.5} />
          </Center>
        </Group>
      </UnstyledButton>
    </Table.Th>
  );
}

function filterData(data, search) {
  const query = search.toLowerCase().trim();
  return data.filter((item) =>
    Object.keys(data[0]).some((key) => item[key].toLowerCase().includes(query))
  );
}

function sortData(data, payload) {
  const { sortBy } = payload;

  if (!sortBy) {
    return filterData(data, payload.search);
  }

  return filterData(
    [...data].sort((a, b) => {
      if (payload.reversed) {
        return b[sortBy].localeCompare(a[sortBy]);
      }

      return a[sortBy].localeCompare(b[sortBy]);
    }),
    payload.search
  );
}

const data = [
  {
    name: 'Athena Weissnat',
    company: 'Little - Rippin',
    email: 'Elouise.Prohaska@yahoo.com',
  },
  {
    name: 'Deangelo Runolfsson',
    company: 'Greenfelder - Krajcik',
    email: 'Kadin_Trantow87@yahoo.com',
  },
  {
    name: 'Danny Carter',
    company: 'Kohler and Sons',
    email: 'Marina3@hotmail.com',
  },
  {
    name: 'Trace Tremblay PhD',
    company: 'Crona, Aufderhar and Senger',
    email: 'Antonina.Pouros@yahoo.com',
  },
  {
    name: 'Derek Dibbert',
    company: 'Gottlieb LLC',
    email: 'Abagail29@hotmail.com',
  },
  {
    name: 'Viola Bernhard',
    company: 'Funk, Rohan and Kreiger',
    email: 'Jamie23@hotmail.com',
  },
  {
    name: 'Austin Jacobi',
    company: 'Botsford - Corwin',
    email: 'Genesis42@yahoo.com',
  },
  {
    name: 'Hershel Mosciski',
    company: 'Okuneva, Farrell and Kilback',
    email: 'Idella.Stehr28@yahoo.com',
  },
  {
    name: 'Mylene Ebert',
    company: 'Kirlin and Sons',
    email: 'Hildegard17@hotmail.com',
  },
  {
    name: 'Lou Trantow',
    company: 'Parisian - Lemke',
    email: 'Hillard.Barrows1@hotmail.com',
  },
  {
    name: 'Dariana Weimann',
    company: 'Schowalter - Donnelly',
    email: 'Colleen80@gmail.com',
  },
  {
    name: 'Dr. Christy Herman',
    company: 'VonRueden - Labadie',
    email: 'Lilyan98@gmail.com',
  },
  {
    name: 'Katelin Schuster',
    company: 'Jacobson - Smitham',
    email: 'Erich_Brekke76@gmail.com',
  },
  {
    name: 'Melyna Macejkovic',
    company: 'Schuster LLC',
    email: 'Kylee4@yahoo.com',
  },
  {
    name: 'Pinkie Rice',
    company: 'Wolf, Trantow and Zulauf',
    email: 'Fiona.Kutch@hotmail.com',
  },
  {
    name: 'Brain Kreiger',
    company: 'Lueilwitz Group',
    email: 'Rico98@hotmail.com',
  },
];

export function TableSort() {
  const [search, setSearch] = useState('');
  const [sortedData, setSortedData] = useState(data);
  const [sortBy, setSortBy] = useState(null);
  const [reverseSortDirection, setReverseSortDirection] = useState(false);

  const setSorting = (field) => {
    const reversed = field === sortBy ? !reverseSortDirection : false;
    setReverseSortDirection(reversed);
    setSortBy(field);
    setSortedData(sortData(data, { sortBy: field, reversed, search }));
  };

  const handleSearchChange = (event) => {
    const { value } = event.currentTarget;
    setSearch(value);
    setSortedData(sortData(data, { sortBy, reversed: reverseSortDirection, search: value }));
  };

  const rows = sortedData.map((row) => (
    <Table.Tr key={row.name}>
      <Table.Td>{row.name}</Table.Td>
      <Table.Td>{row.email}</Table.Td>
      <Table.Td>{row.company}</Table.Td>
    </Table.Tr>
  ));

  return (
    <ScrollArea>
      <TextInput
        placeholder="Search by any field"
        mb="md"
        leftSection={<IconSearch style={{ width: '1rem', height: '1rem' }} stroke={1.5} />}
        value={search}
        onChange={handleSearchChange}
      />
      <Table horizontalSpacing="md" verticalSpacing="xs" minWidth={700} layout="fixed">
        <Table.Tbody>
          <Table.Tr>
            <Th
              sorted={sortBy === 'name'}
              reversed={reverseSortDirection}
              onSort={() => setSorting('name')}
            >
              Name
            </Th>
            <Th
              sorted={sortBy === 'email'}
              reversed={reverseSortDirection}
              onSort={() => setSorting('email')}
            >
              Email
            </Th>
            <Th
              sorted={sortBy === 'company'}
              reversed={reverseSortDirection}
              onSort={() => setSorting('company')}
            >
              Company
            </Th>
          </Table.Tr>
        </Table.Tbody>
        <Table.Tbody>
          {rows.length > 0 ? (
            rows
          ) : (
            <Table.Tr>
              <Table.Td colSpan={3}>
                <Text fontWeight={500} textAlign="center">
                  Nothing found
                </Text>
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>
    </ScrollArea>
  );
}