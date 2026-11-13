----------------------------------------------------------------------------------
-- Project Name : adder
-- Testbench For: adder
-- Module Name  : tb_adder.vhd
-- Entity Name  : tb_adder
-- Target Lang  : VHDL-2008
-- Engineer     : Mahmoodi
-- Create Date  : 2026-11-10
-- Tool Versions: GHDL 6.0.0
----------------------------------------------------------------------------------

library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity tb_adder is
end entity tb_adder;

architecture sim of tb_adder is

  -- clock period constant
  constant CLK_PERIOD : time := 10 ns;

  -- internal interconnect & stimulus signals
  signal A          : std_logic := '0';
  signal B          : std_logic := '0';
  signal Cin        : std_logic := '0';
  signal S          : std_logic := '0';
  signal Cout       : std_logic := '0';

begin

  -- instantiate unit under test (DUT)
  dut : entity work.adder
    port map (
      A          => A,
      B          => B,
      Cin        => Cin,
      S          => S,
      Cout       => Cout
    );

  -- stimulus process: drive input vectors
  stim_proc : process
  begin
    -- initial stimulus state
    A <= '0';
    B <= '0';
    Cin <= '0';
    wait for 20 ns;
        
            A <= '1';
    B <= '0';
    Cin <= '1';
    wait for 20 ns;
        
            A <= '1';
    B <= '1';
    Cin <= '0';
    wait for 20 ns;
        
            A <= '1';
    B <= '1';
    Cin <= '1';
    wait for 20 ns;
            A <= '1';
    B <= '1';
    Cin <= '0';
    wait for 20 ns;
    -- TODO: Add verification stimulus vectors here


    wait; -- simulation complete
  end process stim_proc;

end architecture sim;
