----------------------------------------------------------------------------------
-- Project Name : Counter
-- Testbench For: Counter
-- Module Name  : tb_counter.vhd
-- Entity Name  : tb_Counter
-- Target Lang  : VHDL-2008
-- Description  : Verification testbench for 4-bit binary counter
----------------------------------------------------------------------------------

library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity tb_Counter is
end entity tb_Counter;

architecture sim of tb_Counter is

  -- clock period constant (20 ns period = 50 MHz for fast simulation)
  constant CLK_PERIOD : time := 20 ns;

  -- internal interconnect & stimulus signals
  signal clk       : std_logic := '0';
  signal clear     : std_logic := '0';
  signal data_out  : std_logic_vector(3 downto 0) := (others => '0');

begin

  -- instantiate unit under test (DUT)
  dut : entity work.Counter
    port map (
      clk       => clk,
      clear     => clear,
      data_out  => data_out
    );

  -- clock generator process
  clk_gen : process
  begin
    clk <= '0';
    wait for CLK_PERIOD / 2;
    clk <= '1';
    wait for CLK_PERIOD / 2;
  end process clk_gen;

  -- stimulus process: drive verification stimulus vectors
  stim_proc : process
  begin
    -- initial reset state
    clear <= '1';
    wait for 40 ns;
    clear <= '0';

    -- allow counter to increment through all 16 states (0 to 15)
    wait for 340 ns;

    -- test synchronous clear pulse
    clear <= '1';
    wait for 20 ns;
    clear <= '0';

    -- continue counting after reset
    wait for 100 ns;

    wait; -- simulation complete
  end process stim_proc;

end architecture sim;
