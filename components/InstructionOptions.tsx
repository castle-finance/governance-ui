import { Fragment, useState } from 'react'
import { Listbox, Transition } from '@headlessui/react'
import { SelectorIcon } from '@heroicons/react/solid'

const executionOptions = [
  { name: 'Options' },
  { name: 'Castle: Refresh Vault' },
]

export default function InstructionOptions() {
  const [selected, setSelected] = useState(executionOptions[0])

  return (
    <div className="">
      <Listbox value={selected} onChange={setSelected}>
        <div className="relative">
          <Listbox.Button className="relative py-1 text-left border border-primary-light default-transition font-bold rounded-full px-4 text-primary-light text-sm hover:border-primary-dark hover:text-primary-dark">
            <span className="block truncate mr-3">{selected.name}</span>
            <span className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none">
              <SelectorIcon className="w-5 h-5 text-primary-light" />
            </span>
          </Listbox.Button>
          <Transition
            as={Fragment}
            leave="transition ease-in duration-100"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <Listbox.Options className="absolute text-sm bg-bkg-1 border border-gray-50  py-1 mt-1 overflow-auto text-primary-dark rounded-md shadow-lg max-h-60">
              {executionOptions.map((person, personIdx) => (
                <Listbox.Option
                  key={personIdx}
                  className={({ active }) =>
                    `cursor-default select-none relative py-2 px-4 ${
                      active
                        ? 'text-amber-900 bg-amber-100'
                        : 'text-primary-light'
                    }`
                  }
                  value={person}
                >
                  {({ selected }) => (
                    <>
                      <span
                        className={`block truncate ${
                          selected ? 'font-medium' : 'font-normal'
                        }`}
                      >
                        {person.name}
                      </span>
                      {/* {selected ? (
                        <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-amber-600">
                          <CheckIcon className="w-5 h-5" aria-hidden="true" />
                        </span>
                      ) : null} */}
                    </>
                  )}
                </Listbox.Option>
              ))}
            </Listbox.Options>
          </Transition>
        </div>
      </Listbox>
    </div>
  )
}
